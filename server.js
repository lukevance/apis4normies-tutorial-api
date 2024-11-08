require('dotenv').config();
const express = require('express');
const { Client } = require('@notionhq/client');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(bodyParser.json());

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Initialize the userId counter
let currentUserId = 1; // Start from 1. Note: This will reset every time the server restarts.

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
                    rich_text: [{ text: { content: userId.toString() } }],
                },
                "GitHub Signup Complete": {
                    checkbox: false,
                },
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
        // Search for the user by userId in Notion database
        const notionPages = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID,
            filter: {
                property: 'User ID',
                text: {
                    equals: id.toString(),
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
                "GitHub Username": {
                    rich_text: [{ text: { content: githubUsername } }],
                },
                "GitHub Signup Complete": {
                    checkbox: true,
                },
            },
        });

        res.status(200).send('GitHub username submitted and tracked successfully!');
    } catch (error) {
        console.error('Error updating GitHub username in Notion:', error);
        res.status(500).send('An error occurred while submitting GitHub username.');
    }
});

// Start the Express server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
