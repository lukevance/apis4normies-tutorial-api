// transactionsRoutes.js

const { Client } = require('@notionhq/client');
const express = require('express');
const router = express.Router();

// Initialize the Notion client with the secret key
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Database ID
const databaseId = process.env.NOTION_TRANX_DATABASE_ID;

const createdFilteredResponse = response => {
    return {
        transactionId: response.properties.transactionId.title[0].plain_text,
        userId: response.properties.UserID.number,
        splitToken: response.properties.SplitToken.rich_text[0]?.plain_text || null,
        status: response.properties.Status.select?.name || null,
    };
};

// Retrieve a transaction by transactionId
router.get('/:transactionId', async (req, res) => {
    const transactionId = req.params.transactionId;
    const userId = req.query.userId;

    // Validate required fields
    if (!transactionId || !userId) {
        return res.status(400).json({ error: 'transactionId and userId are required' });
    }

    try {
        // Query the database to find the page ID by transactionId
        const searchResponse = await notion.databases.query({
            database_id: databaseId,
            filter: {
                property: 'transactionId',
                title: {
                    equals: transactionId,
                },
            },
        });

        if (searchResponse.results.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const pageId = searchResponse.results[0].id;
        const response = await notion.pages.retrieve({ page_id: pageId });
        const filteredResponse = createdFilteredResponse(response);
        res.status(200).json(filteredResponse);
    } catch (error) {
        console.error('Error retrieving transaction by transactionId:', error);
        res.status(500).json({ error: 'Error retrieving transaction by transactionId' });
    }
});


// Create a transaction
router.post('/', async (req, res) => {
    const transactionData = req.body;

    // Validate required fields
    if (!transactionData.transactionId || !transactionData.userId) {
        return res.status(400).json({ error: 'transactionId and userId are required' });
    }

    try {
        const response = await notion.pages.create({
            parent: { database_id: databaseId },
            properties: {
                transactionId: {
                    title: [
                        {
                            text: {
                                content: transactionData.transactionId,
                            },
                        },
                    ],
                },
                UserID: {
                    number: transactionData.userId,
                },
                Status: {
                    select: {
                        name: transactionData.status || null,
                    },
                },
            },
        });
        const filteredResponse = createdFilteredResponse(response);
        res.status(201).json(filteredResponse);
    } catch (error) {
        console.error('Error creating transaction:', error);
        res.status(500).json({ error: 'Error creating transaction' });
    }
});

// Patch a transaction by transactionId
router.patch('/:transactionId', async (req, res) => {
    const transactionId = req.params.transactionId;
    const updatedData = req.body;

    // Validate required fields
    if (!updatedData.userId || !updatedData.splitToken) {
        return res.status(400).json({ error: 'splitToken and userId are required' });
    }

    try {
        // Query the database to find the page ID by transactionId
        const searchResponse = await notion.databases.query({
            database_id: databaseId,
            filter: {
                property: 'transactionId',
                title: {
                    equals: transactionId,
                },
            },
        });

        if (searchResponse.results.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const pageId = searchResponse.results[0].id;

        // Update the transaction with the provided data (SplitToken or Status)
        const response = await notion.pages.update({
            page_id: pageId,
            properties: {
                SplitToken: updatedData.splitToken ? {
                    rich_text: [
                        {
                            text: {
                                content: updatedData.splitToken,
                            },
                        },
                    ],
                } : undefined,
                Status: updatedData.status ? { select: { name: updatedData.status } } : undefined,
            },
        });
        const filteredResponse = createdFilteredResponse(response);
        res.status(200).json(filteredResponse);
    } catch (error) {
        console.error('Error updating transaction:', error);
        res.status(500).json({ error: 'Error updating transaction' });
    }
});

// Export the router
module.exports = router;
