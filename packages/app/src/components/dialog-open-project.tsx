import { useLanguage } from "@/context/language"
import { type GitHubAccount, type GitHubRepository, usePlatform } from "@/context/platform"
import type { ServerConnection } from "@/context/server"
import { Avatar } from "@opencode-ai/ui/v2/avatar-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"

type Props = {
  destination: string
  server: ServerConnection.Any
  onOpenFolder(): void
  onOpenProject(directory: string): void
}

type State = {
  source: "github" | "folder"
  account?: GitHubAccount | null
  repositories: GitHubRepository[]
  token: string
  search: string
  destination: string
  selected?: number
  busy?: "status" | "connect" | "repositories" | "disconnect" | "clone"
  error?: string
}

export function DialogOpenProject(props: Props) {
  const platform = usePlatform()
  const github = platform.github
  const language = useLanguage()
  const dialog = useDialog()
  const [state, setState] = createStore<State>({
    source: "github",
    repositories: [],
    token: "",
    search: "",
    destination: props.destination,
    busy: "status",
  })
  let active = true

  const selected = createMemo(() => state.repositories.find((repository) => repository.id === state.selected))
  const repositories = createMemo(() => {
    const query = state.search.trim().toLowerCase()
    if (!query) return state.repositories
    return state.repositories.filter(
      (repository) =>
        repository.nameWithOwner.toLowerCase().includes(query) || repository.description?.toLowerCase().includes(query),
    )
  })

  const fail = (cause: unknown) => {
    if (!active) return
    setState({ busy: undefined, error: cause instanceof Error ? cause.message : language.t("common.requestFailed") })
  }

  const loadRepositories = async () => {
    if (!github) return
    setState({ busy: "repositories", error: undefined, repositories: [], selected: undefined })
    const items = await github.repositories()
    if (!active) return
    setState({ repositories: items, busy: undefined })
  }

  onMount(() => {
    if (!github) {
      setState({ source: "folder", busy: undefined })
      return
    }
    void github
      .status()
      .then((account) => {
        if (!active) return
        setState({ account, busy: undefined })
        if (account) return loadRepositories()
      })
      .catch(fail)
  })

  onCleanup(() => {
    active = false
  })

  const connect = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!github || state.busy || !state.token.trim()) return
    setState({ busy: "connect", error: undefined })
    const account = await github.connect(state.token)
    if (!active) return
    setState({ account, token: "", busy: undefined })
    await loadRepositories()
  }

  const disconnect = async () => {
    if (!github || state.busy) return
    setState({ busy: "disconnect", error: undefined })
    await github.disconnect()
    if (!active) return
    setState({ account: null, repositories: [], selected: undefined, busy: undefined })
  }

  const chooseDestination = async () => {
    if (state.busy) return
    if (platform.platform === "desktop") {
      const result = await platform.openDirectoryPickerDialog({
        title: language.t("dialog.project.open.github.destination.choose"),
        multiple: false,
        defaultPath: state.destination,
      })
      if (typeof result === "string") setState("destination", result)
      return
    }
    const { DialogSelectDirectoryV2 } = await import("./dialog-select-directory-v2")
    if (!active) return
    dialog.push(() => (
      <DialogSelectDirectoryV2
        server={props.server}
        start={state.destination}
        title={language.t("dialog.project.open.github.destination.choose")}
        onSelect={(result) => {
          if (typeof result === "string") setState("destination", result)
        }}
      />
    ))
  }

  const clone = async () => {
    const repository = selected()
    if (!github || !repository || !state.destination || state.busy) return
    setState({ busy: "clone", error: undefined })
    const directory = await github.clone({
      url: repository.cloneUrl,
      destination: state.destination,
      server: props.server.http,
    })
    if (!active) return
    props.onOpenProject(directory)
    dialog.close()
  }

  const openFolder = () => {
    dialog.close()
    queueMicrotask(props.onOpenFolder)
  }

  return (
    <Dialog
      fit
      size="large"
      containerClass="!h-auto max-h-[calc(100dvh_-_16px)]"
      class="[font-family:var(--v2-font-family-sans)]"
    >
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("dialog.project.open.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="min-h-0 gap-0 px-4 pt-4 pb-2">
        <div class="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            data-source="github"
            data-active={state.source === "github" ? "" : undefined}
            class="flex items-center gap-2 rounded-md border border-v2-border-border-muted px-3 py-2 text-left text-13-medium hover:bg-v2-overlay-simple-overlay-hover data-[active]:border-v2-border-border-strong data-[active]:bg-v2-background-bg-layer-02"
            disabled={!github || state.busy === "clone"}
            onClick={() => setState({ source: "github", error: undefined })}
          >
            <Icon name="branch" />
            {language.t("dialog.project.open.github")}
          </button>
          <button
            type="button"
            data-source="folder"
            data-active={state.source === "folder" ? "" : undefined}
            class="flex items-center gap-2 rounded-md border border-v2-border-border-muted px-3 py-2 text-left text-13-medium hover:bg-v2-overlay-simple-overlay-hover data-[active]:border-v2-border-border-strong data-[active]:bg-v2-background-bg-layer-02"
            disabled={state.busy === "clone"}
            onClick={() => setState({ source: "folder", error: undefined })}
          >
            <Icon name="folder" />
            {language.t("dialog.project.open.folder")}
          </button>
        </div>

        <Show when={state.source === "folder"}>
          <div class="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-6 text-center">
            <Icon name="folder" class="size-6 text-v2-icon-icon-muted" />
            <div class="flex flex-col gap-1">
              <div class="text-14-medium text-v2-text-text-base">{language.t("dialog.project.open.folder.title")}</div>
              <div class="text-13-regular text-v2-text-text-muted">
                {language.t("dialog.project.open.folder.description")}
              </div>
            </div>
            <ButtonV2 variant="contrast" onClick={openFolder}>
              {language.t("dialog.project.open.folder.choose")}
            </ButtonV2>
          </div>
        </Show>

        <Show when={state.source === "github"}>
          <Show
            when={state.account}
            fallback={
              <form
                class="flex min-h-52 flex-col justify-center gap-4"
                onSubmit={(event) =>
                  void connect(event).catch((cause: unknown) => {
                    setState("token", "")
                    fail(cause)
                  })
                }
              >
                <div class="flex flex-col gap-1">
                  <div class="text-14-medium text-v2-text-text-base">
                    {language.t("dialog.project.open.github.connect.title")}
                  </div>
                  <div class="text-13-regular text-v2-text-text-muted">
                    {language.t("dialog.project.open.github.connect.description")}
                  </div>
                </div>
                <div class="flex flex-col gap-2">
                  <label class="text-12-medium text-v2-text-text-muted">
                    {language.t("dialog.project.open.github.token")}
                  </label>
                  <TextInputV2
                    type="password"
                    appearance="large"
                    autofocus
                    autocomplete="off"
                    value={state.token}
                    disabled={!!state.busy}
                    invalid={!!state.error}
                    placeholder="github_pat_..."
                    onInput={(event) => setState({ token: event.currentTarget.value, error: undefined })}
                  />
                  <button
                    type="button"
                    class="w-fit text-12-regular text-v2-text-text-muted underline hover:text-v2-text-text-base"
                    onClick={() => platform.openExternal("https://github.com/settings/personal-access-tokens/new")}
                  >
                    {language.t("dialog.project.open.github.token.create")}
                  </button>
                </div>
                <ButtonV2
                  type="submit"
                  variant="contrast"
                  disabled={!state.token.trim() || !!state.busy}
                  class="self-end"
                >
                  {state.busy === "connect"
                    ? language.t("dialog.project.open.github.connecting")
                    : language.t("dialog.project.open.github.connect")}
                </ButtonV2>
              </form>
            }
          >
            {(account) => (
              <div class="flex min-h-0 flex-col gap-3">
                <div class="flex items-center gap-2">
                  <Avatar fallback={account().login} src={account().avatarUrl} size="small" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-13-medium text-v2-text-text-base">
                      {account().name || account().login}
                    </div>
                    <div class="truncate text-12-regular text-v2-text-text-muted">@{account().login}</div>
                  </div>
                  <ButtonV2
                    size="small"
                    variant="ghost-muted"
                    disabled={!!state.busy}
                    onClick={() => void disconnect().catch(fail)}
                  >
                    {language.t("dialog.project.open.github.disconnect")}
                  </ButtonV2>
                </div>
                <Show when={account().storage === "session"}>
                  <div class="rounded-md bg-v2-background-bg-layer-02 px-3 py-2 text-12-regular text-v2-text-text-muted">
                    {language.t("dialog.project.open.github.sessionOnly")}
                  </div>
                </Show>
                <TextInputV2
                  type="search"
                  appearance="large"
                  value={state.search}
                  disabled={state.busy === "repositories"}
                  placeholder={language.t("dialog.project.open.github.search")}
                  onInput={(event) => setState("search", event.currentTarget.value)}
                />
                <div class="min-h-40 max-h-64 overflow-y-auto rounded-lg border border-v2-border-border-muted p-1">
                  <Show
                    when={state.busy !== "repositories"}
                    fallback={
                      <div class="flex h-40 items-center justify-center text-13-regular text-v2-text-text-muted">
                        {language.t("common.loading")}
                      </div>
                    }
                  >
                    <For
                      each={repositories()}
                      fallback={
                        <div class="flex h-40 items-center justify-center px-6 text-center text-13-regular text-v2-text-text-muted">
                          {language.t("dialog.project.open.github.empty")}
                        </div>
                      }
                    >
                      {(repository) => (
                        <button
                          type="button"
                          data-repository={repository.nameWithOwner}
                          data-selected={state.selected === repository.id ? "" : undefined}
                          class="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-v2-overlay-simple-overlay-hover data-[selected]:bg-v2-background-bg-layer-02"
                          onClick={() => setState("selected", repository.id)}
                        >
                          <Icon name="branch" class="mt-0.5 shrink-0 text-v2-icon-icon-muted" />
                          <span class="min-w-0 flex-1">
                            <span class="flex items-center gap-2">
                              <span class="truncate text-13-medium text-v2-text-text-base">
                                {repository.nameWithOwner}
                              </span>
                              <Show when={repository.private}>
                                <Tag>{language.t("dialog.project.open.github.private")}</Tag>
                              </Show>
                            </span>
                            <Show when={repository.description}>
                              <span class="mt-0.5 block truncate text-12-regular text-v2-text-text-muted">
                                {repository.description}
                              </span>
                            </Show>
                          </span>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
                <div class="flex flex-col gap-2">
                  <label class="text-12-medium text-v2-text-text-muted">
                    {language.t("dialog.project.open.github.destination")}
                  </label>
                  <div class="flex gap-2">
                    <TextInputV2 class="min-w-0 flex-1" value={state.destination} readOnly disabled={!!state.busy} />
                    <ButtonV2 disabled={!!state.busy} onClick={() => void chooseDestination().catch(fail)}>
                      {language.t("dialog.project.open.github.destination.choose")}
                    </ButtonV2>
                  </div>
                  <Show when={selected()}>
                    {(repository) => (
                      <div class="truncate text-12-regular text-v2-text-text-muted">
                        {language.t("dialog.project.open.github.destination.hint", { repository: repository().name })}
                      </div>
                    )}
                  </Show>
                </div>
              </div>
            )}
          </Show>
        </Show>

        <Show when={state.error}>
          <div class="mt-3 rounded-md bg-surface-critical-weak px-3 py-2 text-12-regular text-text-on-critical-base">
            {state.error}
          </div>
        </Show>
      </DialogBody>
      <Show when={state.source === "github" && !!state.account}>
        <DialogFooter>
          <ButtonV2 variant="neutral" disabled={!!state.busy} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2
            variant="contrast"
            disabled={!selected() || !state.destination || !!state.busy}
            onClick={() => void clone().catch(fail)}
          >
            {state.busy === "clone"
              ? language.t("dialog.project.open.github.cloning")
              : language.t("dialog.project.open.github.clone")}
          </ButtonV2>
        </DialogFooter>
      </Show>
    </Dialog>
  )
}
