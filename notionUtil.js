const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const findNotionUser = async (userId, userDatabaseId) => {
    try {
        const response = await notion.databases.query({
            database_id: userDatabaseId,
            filter: {
                property: 'User ID',
                number: {
                    equals: parseInt(userId),
                },
            },
        });

        if (response.results.length === 0) {
            return null;
        }

        return response.results[0];
    } catch (error) {
        console.error('Error finding Notion user:', error);
        throw new Error('Error finding Notion user');
    }
};

const findUserAndCheckExistence = async (userId, notion, userDatabaseId, recordDatabaseId) => {
    const user = await findNotionUser(userId, userDatabaseId);
    if (!user) {
        throw new Error('User not found.');
    }

    const chap2Record = await notion.databases.query({
        database_id: recordDatabaseId,
        filter: {
            property: 'Pre Work Leaderboard',
            relation: {
                contains: user.id,
            },
        },
    });

    // TODO: move this error to API handler instead of util function
    if (chap2Record.results.length > 0) {
        throw new Error('User already exists in the database. Use PATCH method to update record instead');
    }

    return user;
};

const createChap2Record = async (user, merchantType, merchantId, notion, databaseId) => {
    const userFirstName = user.properties.Name.title[0].plain_text.split(' ')[0];
    const recordName = `${userFirstName}_${merchantType}`;
    const chap2NewRecord = await notion.pages.create({
        parent: {
            type: 'database_id',
            database_id: databaseId,
        },
        properties: {
            Name: {
                title: [{ text: { content: recordName } }],
            },
            'Pre Work Leaderboard': {
                type: 'relation',
                relation: [
                    {
                        id: user.id,
                    }
                ]
            },
            'MID': {
                type: 'number',
                number: parseInt(merchantId),
            },
        },
    });

    return chap2NewRecord;
};

module.exports = {
    findNotionUser,
    findUserAndCheckExistence,
    createChap2Record,
};