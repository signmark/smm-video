import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.beget.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(options: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}) {
  const from = process.env.SMTP_FROM || 'SMM Manager <info@smmniap.pw>';
  try {
    const info = await transporter.sendMail({
      from,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    console.log(`[email] Отправлено: ${options.subject} → ${options.to} (${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (err: any) {
    console.error(`[email] Ошибка отправки: ${err?.message}`);
    return { ok: false, error: err?.message };
  }
}

export async function sendSubscriptionRequestEmail(
  userEmail: string,
  userName: string,
  plan: string,
  price: string,
  approveUrl?: string,
  rejectUrl?: string,
) {
  const adminEmail = process.env.ADMIN_EMAIL || 'signmark@gmail.com';

  const actionButtons = approveUrl && rejectUrl ? `
    <table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px">
      <tr>
        <td valign="middle">
          <a href="${approveUrl}" style="display:inline-block;padding:12px 28px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;font-family:Arial,sans-serif">✅ Одобрить</a>
        </td>
        <td width="16" style="width:16px;font-size:0;line-height:0">&nbsp;</td>
        <td valign="middle">
          <a href="${rejectUrl}" style="display:inline-block;padding:12px 28px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;font-family:Arial,sans-serif">❌ Отклонить</a>
        </td>
      </tr>
    </table>
  ` : '';

  await sendEmail({
    to: adminEmail,
    subject: `[SMM Manager] Новая заявка на тариф «${plan}»`,
    html: `
      <h2>Новая заявка на подписку</h2>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 12px;color:#666">Пользователь</td><td style="padding:6px 12px"><b>${userName}</b></td></tr>
        <tr><td style="padding:6px 12px;color:#666">Email</td><td style="padding:6px 12px">${userEmail}</td></tr>
        <tr><td style="padding:6px 12px;color:#666">Тариф</td><td style="padding:6px 12px"><b>${plan}</b> (${price})</td></tr>
        <tr><td style="padding:6px 12px;color:#666">Время</td><td style="padding:6px 12px">${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</td></tr>
      </table>
      ${actionButtons}
    `,
  });

  await sendEmail({
    to: userEmail,
    subject: `Заявка на тариф «${plan}» принята — SMM Manager`,
    html: `
      <h2>Ваша заявка принята!</h2>
      <p>Здравствуйте, <b>${userName}</b>!</p>
      <p>Мы получили вашу заявку на тариф <b>${plan}</b> (${price}).</p>
      <p>Администратор активирует подписку в течение рабочего дня и свяжется с вами.</p>
      <p>По вопросам: <a href="https://t.me/signmark">@signmark</a></p>
      <hr/>
      <p style="color:#999;font-size:12px">SMM Manager · <a href="https://smm.omemo.tech">smm.omemo.tech</a></p>
    `,
  });
}

export async function sendSupportEmail(
  userId: string,
  userEmail: string,
  message: string,
  ticketId: string,
) {
  const adminEmail = process.env.ADMIN_EMAIL || 'signmark@gmail.com';

  await sendEmail({
    to: adminEmail,
    subject: `[SMM Manager] Обращение в поддержку ${ticketId}`,
    html: `
      <h2>Новое обращение в техподдержку</h2>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 12px;color:#666">Ticket ID</td><td style="padding:6px 12px"><code>${ticketId}</code></td></tr>
        <tr><td style="padding:6px 12px;color:#666">User ID</td><td style="padding:6px 12px"><code>${userId}</code></td></tr>
        <tr><td style="padding:6px 12px;color:#666">Email</td><td style="padding:6px 12px">${userEmail}</td></tr>
      </table>
      <h3>Сообщение:</h3>
      <p style="background:#f5f5f5;padding:12px;border-radius:6px">${message.replace(/\n/g, '<br/>')}</p>
    `,
  });

  if (userEmail) {
    await sendEmail({
      to: userEmail,
      subject: `Ваше обращение принято [${ticketId}] — SMM Manager`,
      html: `
        <h2>Обращение принято</h2>
        <p>Ваше сообщение получено. Номер обращения: <code>${ticketId}</code></p>
        <p>Мы ответим в течение рабочего дня.</p>
        <p>По срочным вопросам: <a href="https://t.me/signmark">@signmark</a></p>
        <hr/>
        <p style="color:#999;font-size:12px">SMM Manager · <a href="https://smm.omemo.tech">smm.omemo.tech</a></p>
      `,
    });
  }
}
