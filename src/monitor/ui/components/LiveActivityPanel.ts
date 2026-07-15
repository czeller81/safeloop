import type { MonitorViewModel } from '../../viewModel';
import { renderEvidenceStream } from './EvidenceStream';

export function renderLiveActivityPanel(viewModel: MonitorViewModel): string {
  return renderEvidenceStream(viewModel);
}
