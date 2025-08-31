import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

// SMTP konfigurace pro Seznam.cz
const transporter = nodemailer.createTransport({
  host: 'smtp.seznam.cz',
  port: 465,
  secure: true, // SSL/TLS
  auth: {
    user: 'info@wloom.eu',
    pass: 'vokhot-nigvub-vAvfy2'
  },
  tls: {
    rejectUnauthorized: false
  }
});

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

    console.log('📧 Preparing to send email to:', to);
    console.log('📧 Subject:', subject);

    // Email data pro uživatele
    const userMailOptions = {
      from: 'info@wloom.eu',
      to: to,
      subject: subject,
      html: html,
      text: text
    };

    try {
      // Odešli email uživateli
      console.log('📧 Sending email to user:', to);
      const userInfo = await transporter.sendMail(userMailOptions);
      console.log('✅ User email sent successfully:', userInfo.messageId);
      
      return NextResponse.json({
        success: true,
        message: 'Email byl úspěšně odeslán přes SMTP server',
        messageId: userInfo.messageId,
        details: {
          from: userMailOptions.from,
          to: userMailOptions.to,
          subject: userMailOptions.subject,
          timestamp: new Date().toISOString(),
          smtpServer: 'smtp.seznam.cz'
        }
      });
      
    } catch (smtpError: any) {
      console.error('❌ Error sending email via SMTP:', smtpError);
      
      return NextResponse.json(
        { error: `Chyba při odesílání emailu přes SMTP: ${smtpError.message}` },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('❌ Error in send-email API:', error);
    return NextResponse.json(
      { error: 'Chyba při zpracování požadavku' },
      { status: 500 }
    );
  }
}
