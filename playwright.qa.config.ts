/** Q01 on the hackathon Windows machine: installed Chrome, project defaults. */
import { devices } from '@playwright/test';
import base from './playwright.config';

export default {
  ...base,
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
};
