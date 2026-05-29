import { NextRequest, NextResponse } from 'next/server';
import nodemailer, { type Transporter } from 'nodemailer';

export const runtime = 'nodejs';

let transporter: Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.seznam.cz',
      port: Number(process.env.SMTP_PORT || 465),
      secure: true,
      pool: true,
      maxConnections: 1,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
      auth: {
        user: process.env.SMTP_USER || 'info@uctarna.fun',
        pass: process.env.SMTP_PASS || 'xeQvep-coccec-watza7',
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

    const userInfo = await getTransporter().sendMail({
      from: process.env.SMTP_FROM || 'info@uctarna.fun',
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
    console.error('❌ Error in send-email API:', error);

    const message = error instanceof Error ? error.message : 'Neznámá chyba';
    return NextResponse.json(
      { error: `Chyba při odesílání emailu přes SMTP: ${message}` },
      { status: 500 }
    );
  }
}
