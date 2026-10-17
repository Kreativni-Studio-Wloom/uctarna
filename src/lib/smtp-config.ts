export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

const REQUIRED_SMTP_VARS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const;

export class SmtpConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`SMTP není nakonfigurováno – chybí proměnné prostředí: ${missing.join(', ')}`);
    this.name = 'SmtpConfigError';
  }
}

/** Načte SMTP konfiguraci z env. Při chybějících proměnných vyhodí SmtpConfigError (bez hodnot). */
export function getSmtpConfig(): SmtpConfig {
  const missing = REQUIRED_SMTP_VARS.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new SmtpConfigError(missing);
  }

  const user = process.env.SMTP_USER!.trim();
  return {
    host: process.env.SMTP_HOST!.trim(),
    port: Number(process.env.SMTP_PORT || 465),
    user,
    pass: process.env.SMTP_PASS!,
    from: process.env.SMTP_FROM?.trim() || user,
  };
}
