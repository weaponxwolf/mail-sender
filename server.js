require("dotenv").config();

const express = require("express");
const { google } = require("googleapis");
const { OAuth2Client } = require("google-auth-library");
const session = require("express-session");
const ioredis = require("ioredis");
const app = express();
const PORT = 3000;

app.use(
  session({
    secret: "secret",
    resave: false,
    saveUninitialized: true,
  })
);

const redisClient = new ioredis({
  port: 6379,
  host: "localhost",
});

redisClient.on("connect", () => {
  console.log("Redis client connected");
});

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.profile",
  "profile",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.modify",
];

const oAuth2Client = new OAuth2Client(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

app.get("/auth/google", (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  res.redirect(authUrl);
});

const getRandomInterval = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

let baseIntervalId;

app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  const people = google.people({ version: "v1", auth: oAuth2Client });
  const email = await gmail.users.getProfile({
    userId: "me",
  });
  const peopleInfo = await people.people.get({
    resourceName: "people/me",
    personFields: "emailAddresses,names,photos",
  });

  const labels = await gmail.users.labels.list({
    userId: "me",
  });
  const labelname = labels.data.labels.find(
    (label) => label.name === "SENT_REPLY"
  );

  if (!labelname) {
    const label = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: "SENT_REPLY",
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
    req.session.labelId = label.data.id;
  } else {
    req.session.labelId = labelname.id;
  }

  const user = {
    name: peopleInfo.data.names[0].displayName,
    email: email.data.emailAddress,
    profilePic: peopleInfo.data.photos[0].url,
    tokens: tokens,
  };
  req.session.user = user;
  await redisClient.set(user.email, "none");
  res.redirect("/list-messages");
});

const GetThreadsToReply = async (email, gmail) => {
  let response1;
  let datetoday = await redisClient.get(email);
  if (datetoday === "none") {
    response1 = await gmail.users.threads.list({
      userId: "me",
      labelIds: "INBOX",
    });
  } else {
    response1 = await gmail.users.threads.list({
      userId: "me",
      labelIds: "INBOX",
      q: datetoday,
    });
  }
  if (!response1) {
    return null;
  }

  if (!response1.data.threads) {
    return null;
  }
  const recievedThreads = response1.data.threads.map((thread) => {
    return {
      id: thread.id,
    };
  });
  response1 = null;
  let response2;
  if (datetoday === "none") {
    response2 = await gmail.users.threads.list({
      userId: "me",
      labelIds: "SENT",
    });
  } else {
    response2 = await gmail.users.threads.list({
      userId: "me",
      labelIds: "SENT",
      q: (await redisClient.get(email)) || "",
    });
  }

  let FilteredThreads = [];
  if (response2.data.threads) {
    const sentThreads = response2.data.threads;
    response2 = null;
    const sentThreadIds = new Set(sentThreads.map((thread) => thread.id));

    FilteredThreads = recievedThreads.filter((recievedThread) => {
      return !sentThreadIds.has(recievedThread.id);
    });
  } else {
    FilteredThreads = recievedThreads;
  }
  const messages = await Promise.all(
    FilteredThreads.map(async (thread) => {
      try {
        const message = await gmail.users.messages.get({
          userId: "me",
          id: thread.id,
        });
        let from = message.data.payload.headers.find(
          (header) => header.name === "From"
        ).value;
        let subject = message.data.payload.headers.find(
          (header) => header.name === "Subject"
        ).value;
        let messageId = message.data.payload.headers.find(
          (header) => header.name === "Message-ID"
        )?.value;

        let noReplyStrings = [
          "noreply",
          "no-reply",
          "no_reply",
          "noreply@",
          "no-reply@",
          "no_reply@",
          "mailer-daemon",
        ];
        const containsAny = noReplyStrings.some((v) => from.includes(v));
        if (!containsAny && subject.includes("Re:") === false) {
          return {
            threadId: message.data.id,
            from: from,
            subject: subject,
            snippet: message.data.snippet,
            messageId: messageId,
          };
        }
        return null;
      } catch (error) {
        return null;
      }
    })
  );
  const nonNullMessages = messages.filter((message) => message !== null);
  return nonNullMessages;
};

app.get("/list-messages", async (req, res) => {
  if (!req.session.user) {
    res.redirect("/auth/google");
    return;
  }
  const tokens = req.session.user.tokens;
  oAuth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  const messages = await GetThreadsToReply(req.session.user.email, gmail);
  res.send(messages);
});

const sendMessagesWithInterval = async (req, messages, gmail) => {
  messages.forEach(async (message) => {
    const email = [
      `From: ` + req.session.user.name + ` <` + req.session.user.email + `>`,
      "To: " + message.from,
      "References: " + message.messageId,
      "In-Reply-To: " + message.messageId,
      "Content-Type: text/html; charset=utf-8",
      "MIME-Version: 1.0",
      "Subject: Re: " + message.subject,
      "",
      `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Out of Office</title>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            background-color: #f4f4f4;
            text-align: center;
            margin: 0;
            padding: 0;
          }
      
          .container {
            max-width: 600px;
            margin: 20px auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          }
      
          h1 {
            color: #333333;
          }
      
          p {
            color: #666666;
          }
      
          .signature {
            margin-top: 20px;
            font-style: italic;
            color: #888888;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Out of Office</h1>
          <p>Dear ${message.from},</p>
          <p>This is an automated response to let you know that I am currently out of the office.</p>
          <p>If your matter is urgent, please contact at office.</p>
          <p>I will respond to your email as soon as possible upon my return.</p>
          <p>Thank you for your understanding.</p>
          <div class="signature">Best regards,<br>${req.session.user.name}</div>
        </div>
      </body>
      </html>
      `,
      "",
    ];
    const emailJoined = email.join("\n");
    const encodedMessage = Buffer.from(emailJoined)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
        threadId: message.threadId,
      },
    });

    if (response.status === 200) {
      console.log("Replied to " + message.from);
    }
    try {
      const modifyResponse = await gmail.users.messages.modify({
        userId: "me",
        id: message.threadId,
        requestBody: {
          addLabelIds: req.session.labelId,
        },
      });
    } catch (error) {
      console.log(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  });
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 2);
  const todayString = today.toISOString().slice(0, 10).split("-").join("/");
  const tomorrowString = tomorrow
    .toISOString()
    .slice(0, 10)
    .split("-")
    .join("/");
  await redisClient.set(
    req.session.user.email,
    `after:${todayString} before:${tomorrowString}`
  );
};

app.get("/start-replying", async (req, res) => {
  if (!req.session.user) {
    res.redirect("/auth/google");
    return;
  }
  const tokens = req.session.user.tokens;
  oAuth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  baseIntervalId = setInterval(() => {
    const randomDelay = getRandomInterval(20000, 30000);
    setTimeout(async () => {
      const messages = await GetThreadsToReply(req.session.user.email, gmail);
      const response = await sendMessagesWithInterval(req, messages, gmail);
      if (response && response.success === false) {
        clearInterval(baseIntervalId);
        baseIntervalId = null;
      }
    }, randomDelay);
    console.log("Next interval will be in " + randomDelay / 1000 + " seconds");
  }, 10000);

  req.baseIntervalId = baseIntervalId;
  res.send("SENDING MESSAGES");
});

app.get("/stop-replying", (req, res) => {
  if (baseIntervalId) {
    clearInterval(baseIntervalId);
    baseIntervalId = null;
    console.log("MESSAGE SENDING STOPPED");
    res.send("MESSAGE SENDING STOPPED");
  } else {
    res.send("MESSAGE SENDING ALREADY STOPPED");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
