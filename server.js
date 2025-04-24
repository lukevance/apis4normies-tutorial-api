require('dotenv').config();
const express = require('express');
const { Client } = require('@notionhq/client');
const bodyParser = require('body-parser');
const axios = require('axios');
const basicAuth = require('express-basic-auth');

const { findNotionUser, findUserAndChap2Record, createChap2Record, updateChap2Record } = require('./notionUtil');
const transactionsRouter = require('./transactionsRouter');

const app = express();
app.use(bodyParser.json());

// Setup simple basic auth
const apiUsername = process.env.V0_USERNAME;
const apiPW = process.env.V0_PASS;

const apiUsers = { [apiUsername]: apiPW };
app.use(basicAuth({ apiUsers, challenge: true }));

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

app.post('/user/:id/webhook', async (req, res) => {
    const { id } = req.params;
    const { ngrokUrl, delaySeconds } = req.body;
    if (!ngrokUrl || !delaySeconds) {
        res.status(400).send('ngrok URL and delaySeconds are required.');
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
                await axios.post(ngrokUrl, {
                    message: 'This is a test webhook from the server to verify ngrok is working properly!'
                });
                console.log(`Webhook sent to ${ngrokUrl}`);

                // Update the ngrok setup checkbox and ngrok URL in Notion
                await notion.pages.update({
                    page_id: pageId,
                    properties: {
                        "ngrok setup": {
                            checkbox: true,
                        },
                        "ngrok url": {
                            url: ngrokUrl,
                        },
                        "demo app setup": {
                            checkbox: true,
                        }
                    },
                });

                // Generate log text for sample app running
                const timestamp = new Date().toISOString();
                const logText = `log: sample app running at ${timestamp}\n`;

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
            } catch (error) {
                if (error.response && error.response.status === 400 || error.response.status === 405) {
                    // Update the ngrok setup checkbox and ngrok URL even if there's a 400 error
                    await notion.pages.update({
                        page_id: pageId,
                        properties: {
                            "ngrok setup": {
                                checkbox: true,
                            },
                            "ngrok url": {
                                url: ngrokUrl,
                            }
                        },
                    });
                    console.error(`Webhook sent with a 400 error, but marking ngrok setup as true: ${error}`);
                } else {
                    console.error(`Error sending webhook to ${ngrokUrl}:`, error);
                }
            }
        }, delaySeconds * 1000);

        res.status(200).send(`Webhook scheduled to be sent in ${delaySeconds} seconds to ${ngrokUrl}`);
    } catch (error) {
        console.error('Error scheduling webhook:', error);
        res.status(500).send('An error occurred while scheduling the webhook.');
    }
});

// Endpoint to get user details
app.get('/user/:id', async (req, res) => {
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
app.post('/user/:id/node-check', async (req, res) => {
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

app.post('/user/:id/merchant', async (req, res) => {
    const { id } = req.params;
    const { merchantId, merchantType } = req.body;

    if (!merchantId) {
        return res.status(400).send('Merchant is required.');
    }
    if (!merchantType || (merchantType !== 'gaming' && merchantType !== 'biller')) {
        return res.status(400).send('Merchant type must be "gaming" or "biller".');
    }

    try {
        const {user, chap2Record} = await findUserAndChap2Record(id, userDatabaseId, notion, chap2DatabaseId);
        // TODO: throw error if already exists
        if (chap2Record.results.length > 0) {
            throw new Error('User already exists in the database. Use PATCH method to update record instead');
        }
        
        const chap2NewRecord = await createChap2Record(user, merchantType, merchantId, notion, chap2DatabaseId);

        res.status(200).send(`Merchant ID recorded successfully for user: ${user.properties.Name.title[0].plain_text.split(' ')[0]}`);
    } catch (error) {
        console.error('Error recording merchant for User:', error);
        res.status(500).send(error.message);
    }
});

// Endpoint to validate successful establish API call
app.get('/user/:id/establish-return-cancel', async (req, res) => {
    const { id } = req.params;
    const { transactionId, status } = req.query;
    // check if status was successful
    if (status != 2) {
        return res.status(400).send(`Invalid status. Authorization was not successful. \n${JSON.stringify(req.query)}`);
    }
    try {
        // Query the database to find the page ID by userId 
        const {user, chap2Record} = await findUserAndChap2Record(id, notion, userDatabaseId, chap2DatabaseId);
        if (!user) {
            return res.status(404).send('User not found.');
        }
        // create transaction record in Notion
        console.log(chap2Record);
        
        // update chapter 2 db with authorize success
        const updatedChap2Record = await updateChap2Record(chap2Record.id, notion, 'auth success', {
            type: 'checkbox',
            checkbox: true,
        });
        console.log(updatedChap2Record);

        res.status(204).send('Authorization successful. User score updated.');

    } catch (error) {
        console.error('Error validating establish API call:', error);
        res.status(500).send(error.message);
    }
});


app.use('/transactions', transactionsRouter);

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
