const nodemailer = require("nodemailer");

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  async initializeTransporter() {
    try {
      // Create transporter based on environment
      if (process.env.EMAIL_SERVICE === "gmail") {
        this.transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS, // Use App Password for Gmail
          },
        });
      } else if (process.env.SMTP_HOST) {
        // Custom SMTP configuration
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT || 587,
          secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });
      } else {
        // Fallback to Ethereal Email for testing
        console.log("No email configuration found, creating test account...");
        const testAccount = await nodemailer.createTestAccount();
        this.transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false, // true for 465, false for other ports
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
        console.log("Test email account created:", testAccount.user);
      }

      // Verify the connection
      await this.verifyConnection();
    } catch (error) {
      console.error("Failed to initialize email transporter:", error);
      // Create a simple fallback that logs emails instead of sending them
      this.transporter = {
        sendMail: async (options) => {
          console.log("=== EMAIL WOULD BE SENT ===");
          console.log("To:", options.to);
          console.log("Subject:", options.subject);
          console.log("Content:", options.text);
          console.log("=========================");
          return { messageId: "fake-message-id" };
        },
      };
    }
  }

  async sendPasswordResetEmail(email, resetToken, userName) {
    // Wait for transporter to be initialized if it's still null
    if (!this.transporter) {
      await this.initializeTransporter();
    }

    const resetUrl = `${
      process.env.FRONTEND_URL || "http://localhost:5173"
    }/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: `"eduVision Support" <${
        process.env.EMAIL_FROM || "noreply@eduvision.com"
      }>`,
      to: email,
      subject: "Reset Your Password - eduVision",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            .warning { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Password Reset Request</h1>
            </div>
            <div class="content">
              <h2>Hello ${userName}!</h2>
              <p>We received a request to reset your password for your eduVision account. If you didn't make this request, you can safely ignore this email.</p>
              
              <p>To reset your password, click the button below:</p>
              
              <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </div>
              
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; background: #f4f4f4; padding: 10px; border-radius: 5px;">
                ${resetUrl}
              </p>
              
              <div class="warning">
                <strong>⚠️ Important:</strong> This link will expire in 1 hour for security reasons. If the link expires, you'll need to request a new password reset.
              </div>
              
              <p>If you continue to have problems, please contact our support team.</p>
              
              <p>Best regards,<br>The eduVision Team</p>
            </div>
            <div class="footer">
              <p>This email was sent from eduVision. If you didn't request this email, please ignore it.</p>
              <p>© 2025 eduVision. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Hello ${userName}!
        
        We received a request to reset your password for your eduVision account.
        
        To reset your password, visit this link: ${resetUrl}
        
        This link will expire in 1 hour for security reasons.
        
        If you didn't request this password reset, you can safely ignore this email.
        
        Best regards,
        The eduVision Team
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log("Password reset email sent:", info.messageId);

      // Log preview URL for Ethereal Email
      if (
        process.env.NODE_ENV === "development" &&
        !process.env.EMAIL_SERVICE &&
        nodemailer.getTestMessageUrl
      ) {
        console.log("Preview URL:", nodemailer.getTestMessageUrl(info));
      }

      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error("Failed to send password reset email:", error);
      throw new Error("Failed to send email");
    }
  }

  async sendPasswordChangedNotification(email, userName) {
    // Wait for transporter to be initialized if it's still null
    if (!this.transporter) {
      await this.initializeTransporter();
    }

    const mailOptions = {
      from: `"eduVision Support" <${
        process.env.EMAIL_FROM || "noreply@eduvision.com"
      }>`,
      to: email,
      subject: "Password Changed Successfully - eduVision",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Changed</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #00b894 0%, #00cec9 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            .alert { background: #d1ecf1; border: 1px solid #bee5eb; color: #0c5460; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Password Changed Successfully</h1>
            </div>
            <div class="content">
              <h2>Hello ${userName}!</h2>
              <p>This email confirms that your password has been successfully changed for your eduVision account.</p>
              
              <div class="alert">
                <strong>🔒 Security Notice:</strong> If you didn't make this change, please contact our support team immediately.
              </div>
              
              <p>Your account is now secured with your new password. You can continue using eduVision with your updated credentials.</p>
              
              <p>If you have any questions or concerns, please don't hesitate to contact our support team.</p>
              
              <p>Best regards,<br>The eduVision Team</p>
            </div>
            <div class="footer">
              <p>© 2025 eduVision. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Hello ${userName}!
        
        This email confirms that your password has been successfully changed for your eduVision account.
        
        If you didn't make this change, please contact our support team immediately.
        
        Best regards,
        The eduVision Team
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log("Password changed notification sent:", info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error("Failed to send password changed notification:", error);
      throw new Error("Failed to send notification");
    }
  }

  async verifyConnection() {
    try {
      if (this.transporter && this.transporter.verify) {
        await this.transporter.verify();
        console.log("Email service is ready");
        return true;
      }
      return true; // For fallback transporter
    } catch (error) {
      console.error("Email service verification failed:", error);
      return false;
    }
  }
}

module.exports = EmailService;
