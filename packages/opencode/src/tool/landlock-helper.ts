import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export type LandlockHelperStatus = {
  version: "aialra.landlock_helper.v1"
  available: boolean
  mode: "enforce" | "unavailable"
  path?: string
  abi?: number
  error?: string
}

let cached: LandlockHelperStatus | undefined

const SOURCE = String.raw`
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef LANDLOCK_CREATE_RULESET_VERSION
#define LANDLOCK_CREATE_RULESET_VERSION (1U << 0)
#endif

static int ll_create_ruleset(const struct landlock_ruleset_attr *attr, size_t size, __u32 flags) {
  return syscall(__NR_landlock_create_ruleset, attr, size, flags);
}

static int ll_add_rule(int ruleset_fd, enum landlock_rule_type type, const void *attr, __u32 flags) {
  return syscall(__NR_landlock_add_rule, ruleset_fd, type, attr, flags);
}

static int ll_restrict_self(int ruleset_fd, __u32 flags) {
  return syscall(__NR_landlock_restrict_self, ruleset_fd, flags);
}

#if defined(__x86_64__)
#define AIALRA_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define AIALRA_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
#define AIALRA_AUDIT_ARCH 0
#endif

#define AIALRA_DENY (SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA))
#define AIALRA_ALLOW SECCOMP_RET_ALLOW
#define AIALRA_KILL SECCOMP_RET_KILL_PROCESS
#define AIALRA_ARG_LO(index) (offsetof(struct seccomp_data, args) + ((index) * sizeof(uint64_t)))

static void add_stmt(struct sock_filter *filter, size_t *len, uint16_t code, uint32_t k) {
  filter[(*len)++] = (struct sock_filter)BPF_STMT(code, k);
}

static void add_jump(struct sock_filter *filter, size_t *len, uint16_t code, uint32_t k, uint8_t jt, uint8_t jf) {
  filter[(*len)++] = (struct sock_filter)BPF_JUMP(code, k, jt, jf);
}

static void deny_syscall(struct sock_filter *filter, size_t *len, int nr) {
  add_jump(filter, len, BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)nr, 0, 1);
  add_stmt(filter, len, BPF_RET | BPF_K, AIALRA_DENY);
}

static void deny_socket_except_unix(struct sock_filter *filter, size_t *len, int nr) {
  add_jump(filter, len, BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)nr, 0, 4);
  add_stmt(filter, len, BPF_LD | BPF_W | BPF_ABS, AIALRA_ARG_LO(0));
  add_jump(filter, len, BPF_JMP | BPF_JEQ | BPF_K, AF_UNIX, 1, 0);
  add_stmt(filter, len, BPF_RET | BPF_K, AIALRA_DENY);
  add_stmt(filter, len, BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
}

static void deny_socket_domain(struct sock_filter *filter, size_t *len, int nr, int domain) {
  add_jump(filter, len, BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)nr, 0, 4);
  add_stmt(filter, len, BPF_LD | BPF_W | BPF_ABS, AIALRA_ARG_LO(0));
  add_jump(filter, len, BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)domain, 0, 1);
  add_stmt(filter, len, BPF_RET | BPF_K, AIALRA_DENY);
  add_stmt(filter, len, BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
}

static int install_seccomp_filter(const char *profile) {
  if (strcmp(profile, "none") == 0) return 0;
  if (AIALRA_AUDIT_ARCH == 0) {
    fprintf(stderr, "unsupported architecture for seccomp filter\n");
    return -1;
  }

  struct sock_filter filter[256];
  size_t len = 0;
  add_stmt(filter, &len, BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch));
  add_jump(filter, &len, BPF_JMP | BPF_JEQ | BPF_K, AIALRA_AUDIT_ARCH, 1, 0);
  add_stmt(filter, &len, BPF_RET | BPF_K, AIALRA_KILL);
  add_stmt(filter, &len, BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));

#ifdef __NR_ptrace
  deny_syscall(filter, &len, __NR_ptrace);
#endif
#ifdef __NR_process_vm_readv
  deny_syscall(filter, &len, __NR_process_vm_readv);
#endif
#ifdef __NR_process_vm_writev
  deny_syscall(filter, &len, __NR_process_vm_writev);
#endif
#ifdef __NR_io_uring_setup
  deny_syscall(filter, &len, __NR_io_uring_setup);
#endif
#ifdef __NR_io_uring_enter
  deny_syscall(filter, &len, __NR_io_uring_enter);
#endif
#ifdef __NR_io_uring_register
  deny_syscall(filter, &len, __NR_io_uring_register);
#endif
#ifdef __NR_mount
  deny_syscall(filter, &len, __NR_mount);
#endif
#ifdef __NR_umount2
  deny_syscall(filter, &len, __NR_umount2);
#endif
#ifdef __NR_pivot_root
  deny_syscall(filter, &len, __NR_pivot_root);
#endif
#ifdef __NR_chroot
  deny_syscall(filter, &len, __NR_chroot);
#endif
#ifdef __NR_unshare
  deny_syscall(filter, &len, __NR_unshare);
#endif
#ifdef __NR_setns
  deny_syscall(filter, &len, __NR_setns);
#endif
#ifdef __NR_keyctl
  deny_syscall(filter, &len, __NR_keyctl);
#endif
#ifdef __NR_add_key
  deny_syscall(filter, &len, __NR_add_key);
#endif
#ifdef __NR_request_key
  deny_syscall(filter, &len, __NR_request_key);
#endif
#ifdef __NR_bpf
  deny_syscall(filter, &len, __NR_bpf);
#endif
#ifdef __NR_perf_event_open
  deny_syscall(filter, &len, __NR_perf_event_open);
#endif
#ifdef __NR_init_module
  deny_syscall(filter, &len, __NR_init_module);
#endif
#ifdef __NR_finit_module
  deny_syscall(filter, &len, __NR_finit_module);
#endif
#ifdef __NR_delete_module
  deny_syscall(filter, &len, __NR_delete_module);
#endif
#ifdef __NR_kexec_load
  deny_syscall(filter, &len, __NR_kexec_load);
#endif
#ifdef __NR_kexec_file_load
  deny_syscall(filter, &len, __NR_kexec_file_load);
#endif
#ifdef __NR_userfaultfd
  deny_syscall(filter, &len, __NR_userfaultfd);
#endif
#ifdef __NR_open_by_handle_at
  deny_syscall(filter, &len, __NR_open_by_handle_at);
#endif
#ifdef __NR_fanotify_init
  deny_syscall(filter, &len, __NR_fanotify_init);
#endif

#ifdef __NR_socket
  if (strcmp(profile, "network-off") == 0) {
    deny_socket_except_unix(filter, &len, __NR_socket);
  } else {
    deny_socket_domain(filter, &len, __NR_socket, AF_PACKET);
  }
#endif
#ifdef __NR_socketpair
  if (strcmp(profile, "network-off") == 0) {
    deny_socket_except_unix(filter, &len, __NR_socketpair);
  }
#endif

  if (strcmp(profile, "network-off") == 0) {
#ifdef __NR_connect
    deny_syscall(filter, &len, __NR_connect);
#endif
#ifdef __NR_accept
    deny_syscall(filter, &len, __NR_accept);
#endif
#ifdef __NR_accept4
    deny_syscall(filter, &len, __NR_accept4);
#endif
#ifdef __NR_bind
    deny_syscall(filter, &len, __NR_bind);
#endif
#ifdef __NR_listen
    deny_syscall(filter, &len, __NR_listen);
#endif
#ifdef __NR_getpeername
    deny_syscall(filter, &len, __NR_getpeername);
#endif
#ifdef __NR_getsockname
    deny_syscall(filter, &len, __NR_getsockname);
#endif
#ifdef __NR_shutdown
    deny_syscall(filter, &len, __NR_shutdown);
#endif
#ifdef __NR_sendto
    deny_syscall(filter, &len, __NR_sendto);
#endif
#ifdef __NR_sendmmsg
    deny_syscall(filter, &len, __NR_sendmmsg);
#endif
#ifdef __NR_recvmmsg
    deny_syscall(filter, &len, __NR_recvmmsg);
#endif
#ifdef __NR_getsockopt
    deny_syscall(filter, &len, __NR_getsockopt);
#endif
#ifdef __NR_setsockopt
    deny_syscall(filter, &len, __NR_setsockopt);
#endif
  }

  add_stmt(filter, &len, BPF_RET | BPF_K, AIALRA_ALLOW);
  struct sock_fprog prog = {
    .len = (unsigned short)len,
    .filter = filter,
  };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) != 0) {
    fprintf(stderr, "prctl(PR_SET_SECCOMP) failed: %s\n", strerror(errno));
    return -1;
  }
  return 0;
}

static uint64_t handled_access(int abi) {
  uint64_t access =
    LANDLOCK_ACCESS_FS_EXECUTE |
    LANDLOCK_ACCESS_FS_WRITE_FILE |
    LANDLOCK_ACCESS_FS_READ_FILE |
    LANDLOCK_ACCESS_FS_READ_DIR |
    LANDLOCK_ACCESS_FS_REMOVE_DIR |
    LANDLOCK_ACCESS_FS_REMOVE_FILE |
    LANDLOCK_ACCESS_FS_MAKE_CHAR |
    LANDLOCK_ACCESS_FS_MAKE_DIR |
    LANDLOCK_ACCESS_FS_MAKE_REG |
    LANDLOCK_ACCESS_FS_MAKE_SOCK |
    LANDLOCK_ACCESS_FS_MAKE_FIFO |
    LANDLOCK_ACCESS_FS_MAKE_BLOCK |
    LANDLOCK_ACCESS_FS_MAKE_SYM;
  if (abi >= 2) access |= LANDLOCK_ACCESS_FS_REFER;
  if (abi >= 3) access |= LANDLOCK_ACCESS_FS_TRUNCATE;
  return access;
}

static int add_path_rule(int ruleset_fd, const char *path, uint64_t access) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) {
    fprintf(stderr, "open path failed: %s: %s\n", path, strerror(errno));
    return -1;
  }
  struct landlock_path_beneath_attr rule = {
    .allowed_access = access,
    .parent_fd = fd,
  };
  int rc = ll_add_rule(ruleset_fd, LANDLOCK_RULE_PATH_BENEATH, &rule, 0);
  if (rc < 0) fprintf(stderr, "landlock_add_rule failed: %s: %s\n", path, strerror(errno));
  close(fd);
  return rc;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--probe") == 0) {
    int abi = ll_create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 1) {
      fprintf(stderr, "landlock ABI unavailable: %s\n", strerror(errno));
      return 78;
    }
    printf("abi=%d\n", abi);
    return 0;
  }

  const char *read_roots[128];
  const char *write_roots[128];
  const char *seccomp_profile = "restricted";
  int read_count = 0;
  int write_count = 0;
  int command_index = -1;

  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--read-root") == 0 && i + 1 < argc) {
      if (read_count < 128) read_roots[read_count++] = argv[++i];
      continue;
    }
    if (strcmp(argv[i], "--write-root") == 0 && i + 1 < argc) {
      if (write_count < 128) write_roots[write_count++] = argv[++i];
      continue;
    }
    if (strcmp(argv[i], "--seccomp-profile") == 0 && i + 1 < argc) {
      seccomp_profile = argv[++i];
      if (
        strcmp(seccomp_profile, "none") != 0 &&
        strcmp(seccomp_profile, "restricted") != 0 &&
        strcmp(seccomp_profile, "network-off") != 0
      ) {
        fprintf(stderr, "invalid seccomp profile: %s\n", seccomp_profile);
        return 64;
      }
      continue;
    }
    if (strcmp(argv[i], "--") == 0) {
      command_index = i + 1;
      break;
    }
  }

  if (command_index < 0 || command_index >= argc) {
    fprintf(stderr, "usage: landlock-helper --read-root PATH --write-root PATH -- command...\n");
    return 64;
  }

  int abi = ll_create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 1) {
    fprintf(stderr, "landlock ABI unavailable: %s\n", strerror(errno));
    return 78;
  }

  uint64_t handled = handled_access(abi);
  struct landlock_ruleset_attr ruleset = {
    .handled_access_fs = handled,
  };
  int ruleset_fd = ll_create_ruleset(&ruleset, sizeof(ruleset), 0);
  if (ruleset_fd < 0) {
    fprintf(stderr, "landlock_create_ruleset failed: %s\n", strerror(errno));
    return 78;
  }

  uint64_t read_access = LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
  uint64_t write_access = handled;
  for (int i = 0; i < read_count; i++) {
    if (add_path_rule(ruleset_fd, read_roots[i], read_access) < 0) return 78;
  }
  for (int i = 0; i < write_count; i++) {
    if (add_path_rule(ruleset_fd, write_roots[i], write_access) < 0) return 78;
  }

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    fprintf(stderr, "prctl(PR_SET_NO_NEW_PRIVS) failed: %s\n", strerror(errno));
    return 78;
  }
  if (ll_restrict_self(ruleset_fd, 0) != 0) {
    fprintf(stderr, "landlock_restrict_self failed: %s\n", strerror(errno));
    return 78;
  }
  close(ruleset_fd);
  if (install_seccomp_filter(seccomp_profile) != 0) return 78;
  execvp(argv[command_index], &argv[command_index]);
  fprintf(stderr, "execvp failed: %s\n", strerror(errno));
  return 127;
}
`

export function landlockHelperStatus(input?: { refresh?: boolean }): LandlockHelperStatus {
  if (cached && !input?.refresh) return cached
  if (process.platform !== "linux") {
    cached = { version: "aialra.landlock_helper.v1", available: false, mode: "unavailable", error: "unsupported platform" }
    return cached
  }
  const gcc = Bun.which("gcc") ?? Bun.which("cc")
  if (!gcc) {
    cached = { version: "aialra.landlock_helper.v1", available: false, mode: "unavailable", error: "gcc/cc not found" }
    return cached
  }
  if (!fs.existsSync("/usr/include/linux/landlock.h")) {
    cached = { version: "aialra.landlock_helper.v1", available: false, mode: "unavailable", error: "linux/landlock.h not found" }
    return cached
  }
  const dir = path.join(os.tmpdir(), "aialra-landlock-helper")
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const hash = createHash("sha256").update(SOURCE).digest("hex").slice(0, 16)
  const source = path.join(dir, `landlock-helper-${hash}.c`)
  const binary = path.join(dir, `landlock-helper-${hash}`)
  if (!fs.existsSync(binary)) {
    fs.writeFileSync(source, SOURCE, { mode: 0o600 })
    const result = Bun.spawnSync([gcc, "-O2", "-Wall", "-Wextra", source, "-o", binary], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    })
    if (result.exitCode !== 0) {
      cached = {
        version: "aialra.landlock_helper.v1",
        available: false,
        mode: "unavailable",
        error: Buffer.from(result.stderr).toString("utf8").trim() || `compile exit ${result.exitCode}`,
      }
      return cached
    }
    fs.chmodSync(binary, 0o700)
  }
  const probe = Bun.spawnSync([binary, "--probe"], { stdout: "pipe", stderr: "pipe", timeout: 5_000 })
  const abi = Buffer.from(probe.stdout).toString("utf8").match(/abi=(\d+)/)?.[1]
  const smoke = probe.exitCode === 0
    ? Bun.spawnSync([binary, "--read-root", "/", "--", "/bin/true"], { stdout: "pipe", stderr: "pipe", timeout: 5_000 })
    : probe
  const unavailable = smoke.exitCode !== 0
  cached = unavailable
    ? {
        version: "aialra.landlock_helper.v1",
        available: false,
        mode: "unavailable",
        path: binary,
        abi: abi ? Number(abi) : undefined,
        error: Buffer.from(smoke.stderr).toString("utf8").trim(),
      }
    : {
        version: "aialra.landlock_helper.v1",
        available: true,
        mode: "enforce",
        path: binary,
        abi: abi ? Number(abi) : undefined,
      }
  return cached
}
