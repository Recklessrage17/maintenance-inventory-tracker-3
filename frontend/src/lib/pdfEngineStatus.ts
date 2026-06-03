export type PdfEngineStatus = {
  excelAvailable: boolean;
  libreOfficeAvailable: boolean;
  libreOfficePath: string | null;
  preferredEngine: string;
  ready: boolean;
  message: string;
};

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

export async function checkPdfExportEngines(): Promise<PdfEngineStatus> {
  const invoke = getTauriInvoke();

  if (!invoke) {
    return {
      excelAvailable: false,
      libreOfficeAvailable: false,
      libreOfficePath: null,
      preferredEngine: "Desktop app required",
      ready: false,
      message: "PDF export engine check is available in the desktop app."
    };
  }

  return invoke<PdfEngineStatus>("check_pdf_export_engines");
}
