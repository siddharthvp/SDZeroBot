import * as nodemailer from 'nodemailer';
import {logFullError} from "./botbase";

/**
 * Module for sending email, since /usr/sbin/exim or /usr/bin/mail
 * are not available within the Toolforge Kubernetes cluster
 */

const transporter = nodemailer.createTransport({
    host: 'mail.tools.wmflabs.org',
    port: 465,
});

export async function sendMail(subject: string, body: string) {
    return transporter.sendMail({
        from: 'tools.sdzerobot@tools.wmflabs.org',
        to: 'tools.sdzerobot@tools.wmflabs.org',
        subject: subject,
        html: body,
    });
}

export async function emailOnError(err: Error, taskname: string, isFatal: boolean) {
    logFullError(err, isFatal);
    sendMail(`${taskname} error`, `n${taskname} task resulted in the error:\n\n${err.stack}\n`);
}
