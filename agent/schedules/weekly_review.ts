import { defineSchedule } from 'eve/schedules';
export default defineSchedule({
  cron:'0 18 * * 0',
  content:'Review the current paper snapshot. Delegate data-quality checks and a performance critique. Identify testable improvements and data gaps. Produce a proposal only; do not promote strategies or alter risk limits. Label fixtures clearly.',
});
