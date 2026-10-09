// Is Twilio set up? Prod has no Twilio yet (Patient Intake PR 2), so the
// code that would text must ask first instead of letting serverEnv throw.
// Configured = account SID, auth token and sending number all set, and
// texting not switched off (TWILIO_ENABLED=false, as in sms/sender.ts).

type Env = Record<string, string | undefined>

export function isTwilioConfigured(env: Env = process.env): boolean {
  const set = (k: string) => typeof env[k] === 'string' && env[k]!.trim() !== ''
  return set('TWILIO_ACCOUNT_SID') && set('TWILIO_AUTH_TOKEN') && set('TWILIO_PHONE_NUMBER') && env['TWILIO_ENABLED'] !== 'false'
}
