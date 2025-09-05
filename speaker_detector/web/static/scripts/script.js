import { setupAccordionNav } from "/static/components/accordion-nav/accordion-nav.js";
import { setupMicTest } from "/static/components/mic-test/mic-test.js";
import { setupEnrollSpeaker } from "/static/components/enroll-speaker/enroll-speaker.js";
import { setupIdentifySpeaker } from "/static/components/identify-speaker/identify-speaker.js";
import { setupMeetingMode } from "/static/components/meeting-mode/meeting-mode.js";
import { setupRecordingsTab } from "/static/components/recordings-tab/recordings-tab.js";
import { setupSpeakersList } from "/static/components/speakers-list/speakers-list.js";
import { setupCorrection } from "/static/components/correction/correction.js";
import { setupMicPopup } from "/static/components/mic-popup/mic-popup.js";
import { setupImproveSpeaker } from "/static/components/improve-speaker/improve-speaker.js";

// ✅ Export setup block so loader can run it later
export function runSetup() {
  setupAccordionNav();
  setupMicTest();
  setupEnrollSpeaker();
  setupIdentifySpeaker();
  setupMeetingMode();
  setupRecordingsTab();

  setupCorrection();
  setupMicPopup();
  setupImproveSpeaker();
}
