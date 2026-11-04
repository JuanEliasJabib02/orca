import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

export function reportHttpLinkBrowserOpenFailure(error: unknown): void {
  toast.error(
    error instanceof Error
      ? error.message
      : translate('auto.lib.workspace.browser.tab.open.urlFailed', 'Unable to open URL.')
  )
}

/** Opens `url` in the system browser, inside `arcSpace` when the Arc spaces opt-in names one. */
export async function openSystemHttpLink(url: string, arcSpace?: string): Promise<void> {
  try {
    // Why only with a space: with the opt-in off, the call stays exactly what it was.
    await (arcSpace ? window.api.shell.openUrl(url, { arcSpace }) : window.api.shell.openUrl(url))
  } catch {
    reportHttpLinkBrowserOpenFailure(null)
  }
}
