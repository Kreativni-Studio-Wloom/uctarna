import { NextRequest, NextResponse } from 'next/server';
import nodemailer, { type Transporter } from 'nodemailer';
import { getSmtpConfig, SmtpConfigError } from '@/lib/smtp-config';

export const runtime = 'nodejs';

let transporter: Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    const smtp = getSmtpConfig();
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: true,
      pool: true,
      maxConnections: 1,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  return transporter;
}

// Endpoint pouze předá hotový HTML/text e-mail přes SMTP – bez Firestore dotazů.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, subject, html, text } = body;

    if (!to || !subject || (!html && !text)) {
      return NextResponse.json(
        { error: 'Chybí povinné parametry: to, subject, html nebo text' },
        { status: 400 }
      );
    }

    const smtp = getSmtpConfig();
    const userInfo = await getTransporter().sendMail({
      from: smtp.from,
      to,
      subject,
      html,
      text,
    });

    return NextResponse.json({
      success: true,
      message: 'Email byl úspěšně odeslán přes SMTP server',
      messageId: userInfo.messageId,
    });
  } catch (error) {
    if (error instanceof SmtpConfigError) {
      console.error('❌ send-email API: SMTP není nakonfigurováno, chybí:', error.missing.join(', '));
      return NextResponse.json(
        { error: 'Odesílání e-mailů není na serveru nakonfigurováno. Kontaktujte správce.' },
        { status: 500 }
      );
    }

    console.error('❌ Error in send-email API:', error);

    const message = error instanceof Error ? error.message : 'Neznámá chyba';
    return NextResponse.json(
      { error: `Chyba při odesílání emailu přes SMTP: ${message}` },
      { status: 500 }
    );
  }
}
