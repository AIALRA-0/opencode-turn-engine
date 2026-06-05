import { describe, expect, test } from "bun:test"
import { SessionSecurity } from "../../src/session/security"
import { CodexTurn, type TurnContext } from "../../src/session/turn-context"
import { MessageID, SessionID } from "../../src/session/schema"

function turn(input: { sessionID: string; cwd: string; requested?: Record<string, unknown> }): TurnContext {
  const messageID = MessageID.make("msg_security_turn")
  return {
    version: "aialra.user_turn.v1",
    turnID: messageID,
    startedAt: Date.now(),
    items: [],
    input_items: [],
    input_schema: {
      codex: "Op::UserInput",
      supported_items: ["text", "image", "local_image", "file", "skill", "mention", "subtask"],
    },
    cwd: input.cwd,
    approval_policy: "on-request",
    sandbox_policy: CodexTurn.defaultSandboxPolicy(input.cwd),
    permission_profile: CodexTurn.workspacePermissionProfile(input.cwd),
    active_permission_profile: { id: ":workspace" },
    model: { providerID: "test", modelID: "test" },
    model_info: CodexTurn.modelInfo({ providerID: "test", modelID: "test" }),
    effort_resolution: CodexTurn.reasoningEffortResolution({
      modelInfo: CodexTurn.modelInfo({ providerID: "test", modelID: "test" }),
    }),
    reasoning_summary_policy: CodexTurn.defaultReasoningSummaryPolicy(),
    service_tier_resolution: CodexTurn.serviceTierResolution({
      modelInfo: CodexTurn.modelInfo({ providerID: "test", modelID: "test" }),
    }),
    dynamic_tools: CodexTurn.defaultDynamicTools({
      requested: {},
      activePermissionProfile: { id: ":workspace" },
      approvalPolicy: "on-request",
      modelSupportsTools: true,
      selectedEnvironmentID: "default",
    }),
    skill_catalog: CodexTurn.defaultSkillCatalog({
      skills: [],
      agent: "build",
      cwd: input.cwd,
      activePermissionProfile: { id: ":workspace" },
      approvalPolicy: "on-request",
      selectedEnvironmentID: "default",
    }),
    collaboration_mode: { kind: "default" },
    environments: [{ environmentID: "default", cwd: input.cwd }],
    selected_environment_id: "default",
    network_permissions: CodexTurn.defaultNetworkPermissions("ask"),
    shell_environment_policy: CodexTurn.defaultShellEnvironmentPolicy(),
    security_constraints: CodexTurn.defaultSecurityConstraints(input.cwd),
    route: "prompt",
    sessionID: SessionID.make(input.sessionID),
    messageID,
    agent: "build",
    noReply: false,
    format: "text",
    thread_settings: {
      requested: input.requested ?? {},
      resolved: {},
      effective: {},
    },
    metadata: { source: "test" },
    extension_data: {},
    retry: CodexTurn.retryConfig({}),
  }
}

describe("SessionSecurity per-turn settings", () => {
  test("public security config exposes runtime enforcement proof", () => {
    SessionSecurity.clearForTest()
    const sessionID = "ses_security_runtime_proof"
    const cwd = "/tmp/aialra-runtime-proof"

    SessionSecurity.update({
      sessionID,
      cwd,
      patch: {
        permissionProfileID: ":read-only",
        approvalPolicy: "never",
        approvalsReviewer: "guardian",
        networkPolicy: "off",
        commandPolicy: "read",
        executorBackend: "codex",
      },
    })

    const config = SessionSecurity.get({ sessionID, cwd })
    expect(config.runtimeProof).toEqual(
      expect.objectContaining({
        version: "aialra.sandbox_control_runtime_proof.v1",
        active_permission_profile_id: ":read-only",
        active_permission_profile_kind: "read_only",
        cwd,
        environment_id: "default",
        environment_cwd: cwd,
        approval_policy: "never",
        approvals_reviewer: "guardian",
        command_policy: "read",
        executor_backend: "codex",
        file_system: expect.objectContaining({
          enforced: true,
          mode: "read_only",
          writable_roots: [],
          symlink_escape_protected: true,
        }),
        network: expect.objectContaining({
          policy: "off",
          access: "restricted",
          disabled: true,
        }),
        live_effect: expect.objectContaining({
          applies_to_next_turn: true,
          applies_to_next_tool_gate: true,
          in_flight_model_requests_not_rewritten: true,
          in_flight_processes_not_rewritten: true,
        }),
      }),
    )

    const effective = SessionSecurity.overrides({ sessionID, cwd })
    expect(effective.activePermissionProfile.id).toBe(config.runtimeProof.active_permission_profile_id)
    expect(effective.fileSystemPolicy.writable_roots).toEqual(Array.from(config.runtimeProof.file_system.writable_roots))
    expect(effective.networkSandboxPolicy.network_disabled).toBe(config.runtimeProof.network?.disabled)
  })

  test("applies turn settings without polluting the session defaults", () => {
    SessionSecurity.clearForTest()
    const sessionID = "ses_security_turn_settings"
    const cwd = "/tmp/aialra-security-default"

    SessionSecurity.update({
      sessionID,
      cwd,
      patch: {
        permissionProfileID: ":workspace",
        approvalPolicy: "on-request",
        networkPolicy: "off",
        commandPolicy: "workspace",
      },
    })

    const oneTurn = SessionSecurity.overrides({
      sessionID,
      cwd,
      turnSettings: {
        cwd: "/tmp/aialra-security-alt",
        permissionProfileID: ":read-only",
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        networkPolicy: "on",
        commandPolicy: "read",
        environmentID: "alt",
      },
    })
    const nextTurn = SessionSecurity.overrides({ sessionID, cwd })

    expect(oneTurn.activePermissionProfile.id).toBe(":read-only")
    expect(oneTurn.requestedPermissionProfile).toEqual(expect.objectContaining({ id: ":read-only", kind: "read_only" }))
    expect(oneTurn.resolvedPermissionProfile).toEqual(expect.objectContaining({ id: ":read-only", kind: "read_only" }))
    expect(oneTurn.approvalPolicy).toBe("never")
    expect(oneTurn.approvalsReviewer).toEqual(expect.objectContaining({ role: "auto_review", id: "auto_review" }))
    expect(oneTurn.networkPolicy).toBe("on")
    expect(oneTurn.commandPolicy).toBe("read")
    expect(oneTurn.selectedEnvironmentID).toBe("alt")
    expect(oneTurn.environments[0].cwd).toBe("/tmp/aialra-security-alt")
    expect(oneTurn.threadSettings.requested).toEqual(
      expect.objectContaining({
        permissionProfileID: ":read-only",
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        networkPolicy: "on",
        commandPolicy: "read",
        environmentID: "alt",
      }),
    )
    expect(oneTurn.threadSettings.effective).toEqual(
      expect.objectContaining({
        cwd: "/tmp/aialra-security-alt",
        approval_policy: "never",
        approvals_reviewer: expect.objectContaining({ role: "auto_review", id: "auto_review" }),
        permission_profile_id: ":read-only",
        requested_permission_profile: expect.objectContaining({ kind: "read_only" }),
        resolved_permission_profile: expect.objectContaining({ kind: "read_only" }),
        network_policy: "on",
        network_sandbox_policy: expect.objectContaining({
          version: "aialra.network_sandbox_policy.v1",
          mode: "on",
          network_disabled: false,
          selected_environment_id: "alt",
        }),
        command_policy: "read",
        environment_id: "alt",
        file_system_policy: expect.objectContaining({
          version: "aialra.file_system_sandbox_policy.v1",
          cwd: "/tmp/aialra-security-alt",
          selected_environment_id: "alt",
          writable_roots: [],
        }),
        effective_permission_profile: expect.objectContaining({
          version: "aialra.effective_permission_profile.v1",
          cwd: "/tmp/aialra-security-alt",
          environment_cwd: "/tmp/aialra-security-alt",
          active_permission_profile: expect.objectContaining({ id: ":read-only", kind: "read_only" }),
          sandbox_policy: expect.objectContaining({ type: "read-only", network_access: true }),
          network_policy: "on",
          network_sandbox_policy: expect.objectContaining({
            version: "aialra.network_sandbox_policy.v1",
            mode: "on",
          }),
          command_policy: "read",
          file_system_policy: expect.objectContaining({
            version: "aialra.file_system_sandbox_policy.v1",
            selected_environment_id: "alt",
          }),
          capabilities: expect.arrayContaining(["read_file", "grep"]),
          restrictions: expect.arrayContaining(["write", "network"]),
        }),
      }),
    )

    expect(nextTurn.activePermissionProfile.id).toBe(":workspace")
    expect(nextTurn.activePermissionProfile.kind).toBe("workspace")
    expect(nextTurn.approvalPolicy).toBe("on-request")
    expect(nextTurn.approvalsReviewer).toEqual(expect.objectContaining({ role: "user", id: "current_user" }))
    expect(nextTurn.networkPolicy).toBe("off")
    expect(nextTurn.commandPolicy).toBe("workspace")
    expect(nextTurn.selectedEnvironmentID).toBe("default")
    expect(nextTurn.environments[0].cwd).toBe(cwd)
  })

  test("normalizes human-readable permission profile aliases into active profile descriptors", () => {
    SessionSecurity.clearForTest()
    const sessionID = "ses_security_profile_alias"

    const current = SessionSecurity.overrides({
      sessionID,
      cwd: "/tmp/aialra-security-profile",
      turnSettings: {
        permissionProfileID: "full",
        commandPolicy: "all",
      },
    })

    expect(current.requestedPermissionProfile).toEqual(
      expect.objectContaining({
        requestedID: "full",
        resolvedID: ":danger-full-access",
        kind: "full",
      }),
    )
    expect(current.resolvedPermissionProfile).toEqual(
      expect.objectContaining({
        requestedID: "full",
        resolvedID: ":danger-full-access",
        kind: "full",
      }),
    )
    expect(current.activePermissionProfile).toEqual(
      expect.objectContaining({
        id: ":danger-full-access",
        kind: "full",
        capabilities: expect.arrayContaining(["bash", "network"]),
        restrictions: expect.arrayContaining(["security_constraints_still_apply"]),
      }),
    )
    expect(current.permissionProfile).toEqual(CodexTurn.fullAccessPermissionProfile())
    expect(current.threadSettings.effective.effective_permission_profile).toEqual(
      expect.objectContaining({
        active_permission_profile: expect.objectContaining({
          id: ":danger-full-access",
          kind: "full",
        }),
        permission_profile: CodexTurn.fullAccessPermissionProfile(),
        sandbox_policy: expect.objectContaining({ type: "danger-full-access" }),
        file_system_policy: expect.objectContaining({
          writable_roots: expect.arrayContaining([expect.stringMatching(/^\/$/)]),
        }),
      }),
    )
  })

  test("live security merge preserves a per-turn selected environment cwd", () => {
    SessionSecurity.clearForTest()
    const sessionID = "ses_security_apply_turn_settings"
    SessionSecurity.update({
      sessionID,
      cwd: "/tmp/aialra-security-session",
      patch: {
        permissionProfileID: ":workspace",
        networkPolicy: "off",
        commandPolicy: "workspace",
      },
    })

    const merged = SessionSecurity.applyToTurn(
      turn({
        sessionID,
        cwd: "/tmp/aialra-security-session",
        requested: {
          cwd: "/tmp/aialra-security-turn",
          environmentID: "turn-env",
          networkPolicy: "on",
        },
      }),
    )

    expect(CodexTurn.environmentCwd(merged)).toBe("/tmp/aialra-security-turn")
    expect(merged.selected_environment_id).toBe("turn-env")
    expect(merged.network_policy).toBe("on")
    expect(merged.thread_settings.effective).toEqual(
      expect.objectContaining({
        cwd: "/tmp/aialra-security-turn",
        environment_id: "turn-env",
        network_policy: "on",
        effective_permission_profile: expect.objectContaining({
          selected_environment_id: "turn-env",
          environment_cwd: "/tmp/aialra-security-turn",
          network_policy: "on",
          network_sandbox_policy: expect.objectContaining({
            selected_environment_id: "turn-env",
            mode: "on",
          }),
          file_system_policy: expect.objectContaining({
            selected_environment_id: "turn-env",
            environment_cwd: "/tmp/aialra-security-turn",
          }),
        }),
      }),
    )
    expect(merged.effective_permission_profile).toEqual(
      expect.objectContaining({
        selected_environment_id: "turn-env",
        environment_cwd: "/tmp/aialra-security-turn",
        active_permission_profile: expect.objectContaining({ id: ":workspace" }),
      }),
    )
    expect(merged.file_system_policy).toEqual(
      expect.objectContaining({
        selected_environment_id: "turn-env",
        environment_cwd: "/tmp/aialra-security-turn",
        writable_roots: expect.arrayContaining(["/tmp/aialra-security-turn"]),
      }),
    )
  })

  test("normalizes fine-grained network permission controls into effective turn context", () => {
    SessionSecurity.clearForTest()
    const sessionID = "ses_security_network_permissions"
    SessionSecurity.update({
      sessionID,
      cwd: "/tmp/aialra-security-network",
      patch: {
        networkPolicy: "on",
        networkPermissions: {
          allowlist: ["GitHub.com", "pypi.org"],
          denylist: ["internal.example"],
          privateNetwork: "ask",
          proxyEnabled: true,
          proxyURL: "http://proxy.local:8080",
          tools: {
            webfetch: "ask",
            bash: "on",
          },
        },
      },
    })

    const current = SessionSecurity.overrides({
      sessionID,
      cwd: "/tmp/aialra-security-network",
    })

    expect(current.networkPermissions).toEqual({
      version: "aialra.network_permissions.v1",
      mode: "on",
      allowlist: ["github.com", "pypi.org"],
      denylist: ["internal.example"],
      private_network: "ask",
      proxy: {
        enabled: true,
        url: "http://proxy.local:8080",
      },
      tools: {
        webfetch: "ask",
        bash: "on",
      },
    })
    expect(current.threadSettings.effective).toEqual(
      expect.objectContaining({
        network_permissions: current.networkPermissions,
        network_proxy: expect.objectContaining({
          version: "aialra.network_proxy.v1",
          enabled: true,
          required: true,
          enforcement: "environment",
          url: "http://proxy.local:8080",
        }),
      }),
    )
    expect(current.effectivePermissionProfile).toEqual(
      expect.objectContaining({
        network_proxy: expect.objectContaining({
          version: "aialra.network_proxy.v1",
          required: true,
          enforcement: "environment",
        }),
      }),
    )
  })

  test("normalizes shell environment policy controls into effective turn context", () => {
    SessionSecurity.clearForTest()
    const sessionID = "ses_security_shell_env"
    SessionSecurity.update({
      sessionID,
      cwd: "/tmp/aialra-security-shell-env",
      patch: {
        shellEnvironmentPolicy: {
          mode: "clear",
          allowlist: ["PATH", "OPENAI_API_KEY"],
          denylist: ["*_TOKEN", "SSH_AUTH_SOCK"],
          redact: ["OPENAI_API_KEY"],
          overrides: {
            OPENAI_API_KEY: "safe-test-value",
          },
          safeDefaults: true,
          perEnvironment: {
            default: {
              AIALRA_SAFE_VAR: "ok",
            },
          },
        },
      },
    })

    const current = SessionSecurity.overrides({
      sessionID,
      cwd: "/tmp/aialra-security-shell-env",
    })

    expect(current.shellEnvironmentPolicy).toEqual({
      version: "aialra.shell_environment_policy.v1",
      mode: "clear",
      allowlist: ["PATH", "OPENAI_API_KEY"],
      denylist: ["*_TOKEN", "SSH_AUTH_SOCK"],
      redact: ["OPENAI_API_KEY"],
      overrides: {
        OPENAI_API_KEY: "safe-test-value",
      },
      safe_defaults: true,
      per_environment: {
        default: {
          AIALRA_SAFE_VAR: "ok",
        },
      },
    })
    expect(current.threadSettings.effective).toEqual(
      expect.objectContaining({
        shell_environment_policy: current.shellEnvironmentPolicy,
      }),
    )
  })

  test("environment status describes local and unsupported runtimes with capabilities", () => {
    SessionSecurity.clearForTest()
    const sessionID = "ses_security_environment_status"
    SessionSecurity.update({
      sessionID,
      cwd: "/tmp/aialra-security-env",
      patch: {
        networkPolicy: "on",
        environmentID: "default",
      },
    })

    const status = SessionSecurity.environmentStatus({
      sessionID,
      cwd: "/tmp/aialra-security-env",
    })

    expect(status.selectedEnvironmentID).toBe("default")
    expect(status.selectedEnvironmentCwd).toBe("/tmp/aialra-security-env")
    expect(status.environments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          environmentID: "default",
          kind: "local",
          runtimeID: "local:default:/tmp/aialra-security-env",
          shell: expect.objectContaining({ kind: "local", status: "ready" }),
          fileSystem: expect.objectContaining({
            kind: "local",
            cwd: "/tmp/aialra-security-env",
            protectedPaths: expect.arrayContaining([
              "/tmp/aialra-security-env/.git",
              "/tmp/aialra-security-env/.agents",
              "/tmp/aialra-security-env/.codex",
            ]),
          }),
          network: { policy: "on", access: "enabled" },
          sandbox: expect.objectContaining({ policy: "workspace-write", enforced: true }),
          connection: expect.objectContaining({ state: "ready" }),
          capabilities: expect.arrayContaining(["filesystem", "shell", "sandbox", "network"]),
        }),
        expect.objectContaining({
          environmentID: "remote",
          kind: "disabled",
          connection: expect.objectContaining({ state: "unsupported" }),
          capabilities: ["descriptor-only"],
        }),
        expect.objectContaining({
          environmentID: "container",
          kind: "disabled",
          connection: expect.objectContaining({ state: "unsupported" }),
          capabilities: ["descriptor-only"],
        }),
        expect.objectContaining({
          environmentID: "external",
          kind: "disabled",
          connection: expect.objectContaining({ state: "unsupported" }),
          capabilities: ["descriptor-only"],
        }),
      ]),
    )
  })
})
