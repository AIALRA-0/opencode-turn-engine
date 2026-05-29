import { For, Show } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import type { PermissionDecision } from "./session-composer-state"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: PermissionDecision) => void
}) {
  const language = useLanguage()

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  const actions: Array<{
    decision: PermissionDecision
    label: string
    title: string
    variant: "ghost" | "secondary" | "primary"
  }> = [
    { decision: "reject", label: "拒绝", title: "拒绝这次审批请求", variant: "ghost" },
    { decision: "once-command", label: "仅本次", title: "仅允许这一次本命令", variant: "secondary" },
    {
      decision: "turn-command",
      label: "本轮本命令",
      title: "本对话单轮允许本命令，当前回合内同类命令自动允许",
      variant: "secondary",
    },
    {
      decision: "turn-all",
      label: "本轮全部",
      title: "本对话单轮允许全部命令，当前回合内后续审批自动允许",
      variant: "secondary",
    },
    {
      decision: "always-command",
      label: "始终本命令",
      title: "本对话始终允许本命令，后续同类命令自动允许",
      variant: "secondary",
    },
    {
      decision: "always-all",
      label: "始终全部",
      title: "本对话始终允许全部命令，仍不会绕过文件和网络沙箱",
      variant: "primary",
    },
  ]

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions" class="flex flex-wrap justify-end gap-1.5">
            <For each={actions}>
              {(action) => (
                <Tooltip value={action.title}>
                  <Button
                    variant={action.variant}
                    size="small"
                    class="h-7 px-2 text-11-medium"
                    onClick={() => props.onDecide(action.decision)}
                    disabled={props.responding}
                  >
                    {action.label}
                  </Button>
                </Tooltip>
              )}
            </For>
          </div>
        </>
      }
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={props.request.patterns.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>

      <div data-slot="permission-row">
        <span data-slot="permission-spacer" aria-hidden="true" />
        <div data-slot="permission-hint">
          本轮类按钮只影响当前回合，始终类按钮会自动处理后续审批，但不会绕过沙盒控制中心里的文件和网络限制
        </div>
      </div>
    </DockPrompt>
  )
}
