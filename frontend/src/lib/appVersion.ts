type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function getTauriInvoke(): TauriInvoke | undefined {
  const tauriWindow = window as Window & {
    __TAURI__?: {
      core?: {
        invoke?: TauriInvoke;
      };
    };
  };

  return tauriWindow.__TAURI__?.core?.invoke;
}

export async function getAppVersion(fallbackVersion: string): Promise<string> {
  const invoke = getTauriInvoke();

  if (!invoke) {
    return fallbackVersion;
  }

  return invoke<string>("get_app_version");
}
