import {AuthManager, bot} from "./botbase";
import * as FormData from 'form-data';
import {MwnDate} from "../mwn";

const creds = AuthManager.get('wm-api-gateway');

let accessToken: string;
let accessTokenExpiry: MwnDate;

async function fetchAccessToken() {
    const form = new FormData();
    form.append('grant_type', 'client_credentials');
    form.append('client_id', creds.clientId);
    form.append('client_secret', creds.clientSecret);

    const response = await bot.rawRequest({
        method: 'POST',
        url: 'https://meta.wikimedia.org/w/rest.php/oauth2/access_token',
        data: form,
        headers: {
            ...form.getHeaders(),
            'Content-Length': form.getLengthSync()
        }
    });

    const result = response.data;
    accessToken = result.access_token;
    // refresh 20 seconds before token expires
    accessTokenExpiry = new bot.Date(Date.now() + (result.expires_in - 20) * 1000);
}

export async function getAccessToken() {
    if (!accessTokenExpiry || accessTokenExpiry.isBefore(new Date())) {
        await fetchAccessToken();
    }
    return accessToken;
}
