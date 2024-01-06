# Automated Email Sender
### Description
🤖 This is a Node.js application for automating the sending of out-of-office email replies using the Gmail API. The application periodically checks for new emails in the user's inbox, identifies threads that require a reply, and sends an out-of-office response to those threads. The sending interval is randomized to simulate a more natural behavior and avoid triggering spam filters.

### Prerequisites
Before running the application, ensure you have the following prerequisites installed:
```
🚀 Node.js: https://nodejs.org/
🔄 Redis Server: https://redis.io/download
```
### Installation
- 📂 Clone the repository:
```
git clone https://github.com/weaponxwolf/mail-sender.git
```
- 📁 Change into the project directory:
```
cd mail-sender
```

- 🛠️ Install dependencies:
```
npm install
```

- 🔑 Create a .env file in the project root and add the following environment variables:
```
CLIENT_ID=your_google_client_id
CLIENT_SECRET=your_google_client_secret
REDIRECT_URI=your_google_redirect_uri
```

Replace your_google_client_id, your_google_client_secret, and your_google_redirect_uri with your Google API credentials.

- 🚀 Start the Redis server:
```
redis-server
```
- ▶️ Start the application:
```
Copy code
npm start
```
### Usage
- 🌐 Open your web browser and navigate to http://localhost:3000/auth/google to authenticate the application with your Google account.

- 🔄 After authentication, the application will redirect you to http://localhost:3000/list-messages to display a list of email threads that require a reply.

- 🚀 To start the automated email sending process, visit http://localhost:3000/send-mail. The application will periodically check for new threads and send out-of-office replies.

- ⏹️ To stop the automated email sending process, visit http://localhost:3000/stop-mail.

### Important Notes 
- 📡 This application uses the Gmail API, and you need to set up a project in the Google Cloud Console to obtain API credentials.

- 🤐 Make sure to handle your API credentials securely and do not expose them in public repositories.

- 🔄 The application uses Redis to store information about the last checked date, ensuring that only new threads are considered in subsequent checks.

- ⏰ Adjust the interval and delay settings in the code according to your preferences and Gmail API usage limits.

## License
This project is licensed under the MIT License - see the LICENSE file for details.
