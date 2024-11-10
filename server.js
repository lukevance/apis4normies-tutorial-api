require('dotenv').config();
const express = require('express');
const { Client } = require('@notionhq/client');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Initialize the userId counter based on the highest existing User ID in the database
let currentUserId;

const initializeUserId = async () => {
    try {
        const notionPages = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID,
        });
        const userIds = notionPages.results.map(page => page.properties["User ID"].number);
        currentUserId = userIds.length > 0 ? Math.max(...userIds) + 1 : 1;
    } catch (error) {
        console.error('Error initializing user ID:', error);
        currentUserId = 1; // Fallback to 1 if there's an error
    }
};

initializeUserId();

// Endpoint to create a user and return a userId
app.post('/user', async (req, res) => {
    const { name } = req.body;
    if (!name) {
        res.status(400).send('Name is required.');
        return;
    }

    try {
        const userId = currentUserId++; // Assign current ID and increment

        // Add entry to Notion database
        await notion.pages.create({
            parent: { database_id: process.env.NOTION_DATABASE_ID },
            properties: {
                Name: {
                    title: [{ text: { content: name } }],
                },
                "User ID": {
                    number: userId,
                }
            },
        });

        res.status(200).send({ userId: userId, message: 'User created successfully!' });
    } catch (error) {
        console.error('Error creating user in Notion:', error);
        res.status(500).send('An error occurred while creating the user.');
    }
});

// Endpoint for submitting GitHub username
app.patch('/user/:id', async (req, res) => {
    const { id } = req.params;
    const { githubUsername } = req.body;
    if (!githubUsername) {
        res.status(400).send('GitHub username is required.');
        return;
    }

    try {
        // Validate GitHub username by making a request to GitHub API
        const githubResponse = await axios.get(`https://api.github.com/users/${githubUsername}`);
        if (githubResponse.status !== 200) {
            res.status(400).send('Invalid GitHub username.');
            return;
        }

        // Search for the user by userId in Notion database
        const notionPages = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID,
            filter: {
                property: 'User ID',
                number: {
                    equals: parseInt(id),
                },
            },
        });

        if (notionPages.results.length === 0) {
            res.status(404).send('User ID not found in Notion.');
            return;
        }

        const pageId = notionPages.results[0].id;

        // Update the user entry with GitHub username
        await notion.pages.update({
            page_id: pageId,
            properties: {
                "Github username": {
                    rich_text: [{ text: { content: githubUsername } }],
                },
                "Github signup": {
                    checkbox: true,
                },
            },
        });

        res.status(200).send('GitHub username submitted and tracked successfully!');
    } catch (error) {
        if (error.response && error.response.status === 404) {
            res.status(400).send('Invalid GitHub username.');
        } else {
            console.error('Error updating GitHub username in Notion:', error);
            res.status(500).send('An error occurred while submitting GitHub username.');
        }
    }
});

// Endpoint to schedule a webhook to be sent back to the provided ngrok URL
app.post('/schedule-webhook', async (req, res) => {
    const { ngrokUrl, delaySeconds } = req.body;
    if (!ngrokUrl || !delaySeconds) {
        res.status(400).send('ngrok URL and delaySeconds are required.');
        return;
    }

    try {
        // Schedule the webhook to be sent after delaySeconds
        setTimeout(async () => {
            try {
                await axios.post(ngrokUrl, {
                    message: 'This is a test webhook from the server to verify ngrok is working properly!'
                });
                console.log(`Webhook sent to ${ngrokUrl}`);
            } catch (error) {
                console.error(`Error sending webhook to ${ngrokUrl}:`, error);
            }
        }, delaySeconds * 1000);

        res.status(200).send(`Webhook scheduled to be sent in ${delaySeconds} seconds to ${ngrokUrl}`);
    } catch (error) {
        console.error('Error scheduling webhook:', error);
        res.status(500).send('An error occurred while scheduling the webhook.');
    }
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});