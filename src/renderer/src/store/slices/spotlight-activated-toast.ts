import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  SpotlightActivationTerminal,
  SpotlightServerAutostart
} from '@/lib/spotlight-server-autostart'

function activatedDescription(server: SpotlightServerAutostart): string {
  switch (server.kind) {
    case 'none':
      return translate(
        'auto.store.slices.spotlight.activatedLogs',
        'Server logs are mirrored for agents at .orca/spotlight.log'
      )
    case 'queued':
    case 'started':
      return translate(
        'auto.store.slices.spotlight.activatedStarting',
        'Starting {{command}} — logs at .orca/spotlight.log',
        { command: server.command }
      )
    case 'restarted':
      return translate(
        'auto.store.slices.spotlight.activatedRestarting',
        'Restarting with {{command}} — logs at .orca/spotlight.log',
        { command: server.command }
      )
  }
}

/** The single-repo success toast; names the server command when one was started. */
export function toastSpotlightActivated({ opened, server }: SpotlightActivationTerminal): void {
  if (!opened.ok) {
    toast.success(
      translate(
        'auto.store.slices.spotlight.activatedNoTerminal',
        'Spotlight on — open the primary workspace and start your server there'
      )
    )
    return
  }
  toast.success(
    translate(
      'auto.store.slices.spotlight.activated',
      'Spotlight on — the project root now mirrors this workspace'
    ),
    { description: activatedDescription(server) }
  )
}
