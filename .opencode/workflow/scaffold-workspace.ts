/** scaffold 阶段的事务工作区与正式目录提升。 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { atomicRename, safeWriteFile } from "./cross-platform"

const RUN_MARKER = ".sql2java-run-id"

export type ScaffoldFailureKind = "json-syntax" | "schema" | "content" | "workspace"

export interface ScaffoldWorkspaceState {
  attempt: number
  root: string
  lastFailureKind?: ScaffoldFailureKind | null
  lastFailureMessage?: string | null
  committedAt?: string
  previousFinalBackup?: string | null
}

interface RunLike {
  runId: string
  currentPhase?: string | null
  metadata: Record<string, unknown>
}

function stateOf(run: RunLike): ScaffoldWorkspaceState | null {
  const state = run.metadata.scaffoldWorkspace
  if (!state || typeof state !== "object") return null
  const value = state as Partial<ScaffoldWorkspaceState>
  if (!Number.isInteger(value.attempt) || !value.root) return null
  return value as ScaffoldWorkspaceState
}

function attemptRoot(artifactsDir: string, attempt: number): string {
  return join(artifactsDir, "workspace", "scaffold", `attempt-${attempt}`, "project")
}

function markerOwner(finalRoot: string): string | null {
  try {
    return readFileSync(join(finalRoot, RUN_MARKER), "utf-8").trim()
  } catch {
    return null
  }
}

/**
 * 确保当前 run 拥有 scaffold 临时工作区。
 * 老版本运行若已经在正式目录写入同 run 产物，则复制一份进入工作区以支持无损续跑。
 */
export function ensureScaffoldWorkspace(
  run: RunLike,
  artifactsDir: string,
  finalRoot: string,
): ScaffoldWorkspaceState {
  const existing = stateOf(run)
  if (existing) {
    const isAttemptRoot = resolve(existing.root) === resolve(attemptRoot(artifactsDir, existing.attempt))
    const isCommittedRoot = Boolean(existing.committedAt) && resolve(existing.root) === resolve(finalRoot)
    if (isAttemptRoot) {
      mkdirSync(existing.root, { recursive: true })
      return existing
    }
    if (isCommittedRoot && existsSync(existing.root)) return existing
    delete run.metadata.scaffoldWorkspace
  }

  const state: ScaffoldWorkspaceState = {
    attempt: 1,
    root: attemptRoot(artifactsDir, 1),
    lastFailureKind: null,
    lastFailureMessage: null,
  }
  mkdirSync(dirname(state.root), { recursive: true })
  if (existsSync(finalRoot) && markerOwner(finalRoot) === run.runId) {
    cpSync(finalRoot, state.root, { recursive: true, force: true })
  } else {
    mkdirSync(state.root, { recursive: true })
  }
  run.metadata.scaffoldWorkspace = state
  return state
}

export function getScaffoldWorkspace(run: RunLike): ScaffoldWorkspaceState | null {
  return stateOf(run)
}

/** scaffold 阶段写临时目录，其他阶段读取正式目录。 */
export function activeProjectRootFor(run: RunLike, finalRoot: string, artifactsDir?: string): string {
  if (run.currentPhase !== "scaffold") return finalRoot
  const state = stateOf(run)
  if (!state) return finalRoot
  const isAttemptRoot = artifactsDir
    ? resolve(state.root) === resolve(attemptRoot(artifactsDir, state.attempt))
    : true
  const isCommittedRoot = Boolean(state.committedAt) && resolve(state.root) === resolve(finalRoot)
  return isAttemptRoot || isCommittedRoot ? state.root : finalRoot
}

export function recordScaffoldFailure(
  run: RunLike,
  kind: ScaffoldFailureKind,
  message: string,
): void {
  const state = stateOf(run)
  if (!state) return
  state.lastFailureKind = kind
  state.lastFailureMessage = message
  run.metadata.scaffoldWorkspace = state
}

/** 内容错误开始全新尝试，失败目录移入 quarantine，避免残留混入。 */
export function rotateScaffoldWorkspace(run: RunLike, artifactsDir: string): ScaffoldWorkspaceState {
  const current = stateOf(run)
  const nextAttempt = (current?.attempt ?? 0) + 1
  if (current?.root && existsSync(current.root)) {
    const workspaceBase = resolve(join(artifactsDir, "workspace", "scaffold"))
    const currentAttemptRoot = resolve(dirname(current.root))
    if (currentAttemptRoot.startsWith(workspaceBase + sep)) {
      const quarantine = join(
        artifactsDir,
        "quarantine",
        `scaffold-attempt-${current.attempt}-${Date.now()}`,
      )
      mkdirSync(dirname(quarantine), { recursive: true })
      atomicRename(currentAttemptRoot, quarantine)
      const scaffoldArtifact = join(artifactsDir, "scaffold.json")
      if (existsSync(scaffoldArtifact)) {
        atomicRename(scaffoldArtifact, join(quarantine, "scaffold.json"))
      }
    }
  }
  const next: ScaffoldWorkspaceState = {
    attempt: nextAttempt,
    root: attemptRoot(artifactsDir, nextAttempt),
    lastFailureKind: current?.lastFailureKind ?? null,
    lastFailureMessage: current?.lastFailureMessage ?? null,
  }
  mkdirSync(next.root, { recursive: true })
  run.metadata.scaffoldWorkspace = next
  return next
}

export interface ScaffoldCommitResult {
  ok: boolean
  backupPath?: string
  error?: string
}

/**
 * 将已校验工作区提升为正式目录。旧正式目录先移动到 quarantine；提升失败时自动回滚。
 */
export function commitScaffoldWorkspace(
  run: RunLike,
  artifactsDir: string,
  finalRoot: string,
): ScaffoldCommitResult {
  const state = stateOf(run)
  if (!state || !existsSync(state.root)) {
    return { ok: false, error: "scaffold 临时工作区不存在，无法提交" }
  }
  if (resolve(state.root) === resolve(finalRoot)) {
    return state.committedAt
      ? { ok: true, backupPath: state.previousFinalBackup ?? undefined }
      : { ok: false, error: "scaffold 工作区元数据非法：未提交状态指向正式目录" }
  }
  if (resolve(state.root) !== resolve(attemptRoot(artifactsDir, state.attempt))) {
    return { ok: false, error: "scaffold 工作区路径不属于当前 run" }
  }

  let backupPath: string | undefined
  try {
    mkdirSync(dirname(finalRoot), { recursive: true })
    if (existsSync(finalRoot)) {
      backupPath = join(artifactsDir, "quarantine", `scaffold-previous-final-${Date.now()}`)
      mkdirSync(dirname(backupPath), { recursive: true })
      atomicRename(finalRoot, backupPath)
    }
    atomicRename(state.root, finalRoot)
    safeWriteFile(join(finalRoot, RUN_MARKER), run.runId)
    state.committedAt = new Date().toISOString()
    state.previousFinalBackup = backupPath ?? null
    state.root = finalRoot
    state.lastFailureKind = null
    state.lastFailureMessage = null
    run.metadata.scaffoldWorkspace = state
    return { ok: true, backupPath }
  } catch (e: any) {
    try {
      // 若临时项目已被提升，先移回原工作区，保留本次尝试供修复/排查。
      if (existsSync(finalRoot) && !existsSync(state.root)) {
        mkdirSync(dirname(state.root), { recursive: true })
        atomicRename(finalRoot, state.root)
      }
      if (backupPath && existsSync(backupPath) && !existsSync(finalRoot)) {
        atomicRename(backupPath, finalRoot)
      }
    } catch (rollbackError: any) {
      return {
        ok: false,
        backupPath,
        error: `scaffold 目录提升失败: ${e?.message ?? e}；回滚也失败: ${rollbackError?.message ?? rollbackError}`,
      }
    }
    return { ok: false, backupPath, error: `scaffold 目录提升失败: ${e?.message ?? e}` }
  }
}
