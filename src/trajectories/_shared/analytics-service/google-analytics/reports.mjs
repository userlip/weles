// The part of a Google Analytics dashboard an action reads, beyond the
// address its catalog entry declares: the section the vision model opens
// when the address cannot name it, and the data stream's tag installation
// instructions for the action that reads the site tag.
import { clickDescribed } from '../../page/judged/seen.mjs';
import { pageSettled } from '../../page/settled.mjs';
import { openDataStreamDetail } from './web-stream.mjs';

async function openExpectedDashboardSection(s, cfg) {
  if (cfg.section) {
    await clickDescribed(s.page, cfg.section);
    await pageSettled(s.page);
  }
  if (cfg.showsTagInstructions) {
    await openDataStreamDetail(s);
    await pageSettled(s.page);
    await clickDescribed(s.page, 'the button that shows the tag installation instructions');
    await pageSettled(s.page);
  }
}

export { openExpectedDashboardSection };
