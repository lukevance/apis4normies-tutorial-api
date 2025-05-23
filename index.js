require('dotenv').config();
const express = require('express');
const { Client } = require('@notionhq/client');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');

const { findNotionUser, findUserAndChap2Record, createChap2Record, updateChap2Record } = require('./notionUtil');
const transactionsRouter = require('./transactionsRouter');

const app = express();
app.use(bodyParser.json());

app.use(cors());

// Setup simple basic auth
// const apiUsername = process.env.V0_USERNAME;
// const apiPW = process.env.V0_PASS;

// const apiUsers = { [apiUsername]: apiPW };
// app.use(basicAuth({ apiUsers, challenge: true }));

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const userDatabaseId = process.env.NOTION_DATABASE_ID;
const chap2DatabaseId = process.env.NOTION_DATABASE_ID_chap2;

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

// Utility function to find and update a Notion user
async function findAndUpdateNotionUser(userId, properties) {
    // Search for the user by userId in Notion database
    const notionPages = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        filter: {
            property: 'User ID',
            number: {
                equals: parseInt(userId),
            },
        },
    });

    if (notionPages.results.length === 0) {
        throw new Error('User ID not found in Notion.');
    }

    const pageId = notionPages.results[0].id;

    // Update the user entry with provided properties
    await notion.pages.update({
        page_id: pageId,
        properties,
    });

    return pageId;
}

// Endpoint to create a user and return a userId
app.post('/users', async (req, res) => {
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
app.patch('/users/:id', async (req, res) => {
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

        // Define properties to update in Notion
        try {
            const properties = {
                "Github username": {
                    rich_text: [{ text: { content: githubUsername } }],
                },
                "Github signup": {
                    checkbox: true,
                },
            };
            // attempt to update Notion page
            await findAndUpdateNotionUser(id, properties);
            res.status(200).send('GitHub username submitted and tracked successfully!');
        } catch (error) {
            res.status(404).send(error.message);
        }        
    } catch (error) {
        if (error.response && error.response.status === 404) {
            res.status(400).send('Invalid GitHub username.');
        } else {
            console.error('Error updating GitHub username in Notion:', error);
            res.status(500).send('An error occurred while submitting GitHub username.');
        }
    }
});

app.post('/users/:id/webhook', async (req, res) => {
    const { id } = req.params;
    const { webhookUrl, delaySeconds, demoAppId } = req.body;
    
    if (!webhookUrl || !delaySeconds) {
        res.status(400).send('webhook URL and delaySeconds are required.');
        return;
    }

    try {
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

        // Schedule the webhook to be sent after delaySeconds
        setTimeout(async () => {
            try {
                await axios.post(webhookUrl, {
                    message: 'This is a test webhook from the server to verify webhook is working properly!'
                });
                console.log(`Webhook sent to ${webhookUrl}`);

                const notionProperties = {
                    "webhook setup": {
                        checkbox: true,
                    },
                    "webhook url": {
                        url: webhookUrl,
                    }
                };
                
                if (demoAppId) { 
                    notionProperties["demo app setup"] = {checkbox: true};
                }

                // Update the webhook setup checkbox and webhook URL in Notion
                await notion.pages.update({
                    page_id: pageId,
                    properties: notionProperties,
                });
                if (demoAppId){
                    // Generate log text for sample app running
                    const timestamp = new Date().toISOString();
                    const logText = `log: sample app running at ${timestamp}\n\n on plaform ${demoAppId}`;

                    // Append log text to the existing content in the Notion page
                    await notion.blocks.children.append({
                        block_id: pageId,
                        children: [
                            {
                                object: 'block',
                                type: 'paragraph',
                                paragraph: {
                                    rich_text: [
                                        {
                                            type: 'text',
                                            text: {
                                                content: logText,
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    });
                } // end IF demo app is running

            } catch (error) {
                if (error.response && error.response.status === 400 || error.response.status === 405) {
                    // Update the webhook setup checkbox and webhook URL even if there's a 400 error
                    await notion.pages.update({
                        page_id: pageId,
                        properties: {
                            "webhook setup": {
                                checkbox: true,
                            },
                            "webhook url": {
                                url: webhookUrl,
                            }
                        },
                    });
                    console.error(`Webhook sent with a 400 error, but marking webhook setup as true: ${error}`);
                } else {
                    console.error(`Error sending webhook to ${webhookUrl}:`, error);
                }
            }
        }, delaySeconds * 1000);

        res.status(200).send(`Webhook scheduled to be sent in ${delaySeconds} seconds to ${webhookUrl}`);
    } catch (error) {
        console.error('Error scheduling webhook:', error);
        res.status(500).send('An error occurred while scheduling the webhook.');
    }
});

// Endpoint to get user details
app.get('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
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

        const user = notionPages.results[0].properties;
        const userData = {
            name: user.Name.title[0].text.content,
            githubUsername: user["Github username"].rich_text.length > 0 ? user["Github username"].rich_text[0].text.content : null,
            score: user.Score && user.Score.formula ? user.Score.formula.number : 0
        };

        res.status(200).send(userData);
    } catch (error) {
        console.error('Error retrieving user from Notion:', error);
        res.status(500).send('An error occurred while retrieving the user.');
    }
});

// Endpoint to submit Node and npm version
app.post('/users/:id/node-check', async (req, res) => {
    const { id } = req.params;
    const { nodeVersion, npmVersion } = req.body;
    if (!nodeVersion || !npmVersion) {
        res.status(400).send('Node version and npm version are required.');
        return;
    }

    try {
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

        // Generate log text for Node and npm version
        const timestamp = new Date().toISOString();
        const logText = `log: user submitted node-check at ${timestamp}
node version: ${nodeVersion}
npm version: ${npmVersion}
----------`;

        // Append log text to the existing content in the Notion page
        await notion.blocks.children.append({
            block_id: pageId,
            children: [
                {
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                        rich_text: [
                            {
                                type: 'text',
                                text: {
                                    content: logText,
                                },
                            },
                        ],
                    },
                },
            ],
        });

        await notion.pages.update({
            page_id: pageId,
            properties: {
                "Node setup": {
                    checkbox: true,
                }
            },
        });

        res.status(200).send('Node and npm versions submitted and logged successfully!');
    } catch (error) {
        console.error('Error appending log to Notion:', error);
        res.status(500).send('An error occurred while submitting Node and npm versions.');
    }
});

const userHandler = async (req, res) => {
    try {
        const notionPages = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID,
        });

        const scoreboardData = notionPages.results.map(page => {
            const properties = page.properties;
            return {
                name: properties.Name?.title?.[0]?.text?.content || 'No Name',
                id: properties["User ID"].number,
                score: properties.Score?.formula?.number || 0,
                lastEditedTime: page.last_edited_time,
            };
        });

        scoreboardData.sort((a, b) => {
            // Sort by score descending
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            // If scores are equal, sort by last edited time ascending
            return new Date(b.lastEditedTime) - new Date(a.lastEditedTime);
        });

        res.status(200).json(scoreboardData);
    } catch (error) {
        console.error('Error fetching and sorting scoreboard data:', error);
        res.status(500).send('An error occurred while fetching the scoreboard.');
    }
};

app.get('/scoreboard', userHandler);
app.get('/users', userHandler);

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
