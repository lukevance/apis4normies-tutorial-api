const { Client } = require('@notionhq/client');
// const notion = new Client({ auth: process.env.NOTION_API_KEY });

const findNotionUser = async (userId, notion, userDatabaseId) => {
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

const findUserAndChap2Record  = async (userId, notion, userDatabaseId, recordDatabaseId) => {
    const user = await findNotionUser(userId, notion, userDatabaseId);
    if (!user) {
        throw new Error('User not found.');
    }

    const chap2RecordsFound = await notion.databases.query({
        database_id: recordDatabaseId,
        filter: {
            property: 'Pre Work Leaderboard',
            relation: {
                contains: user.id,
            },
        },
    });
    const chap2Record = chap2RecordsFound.results.length === 0 ? null : chap2RecordsFound.results[0];

    return {user, chap2Record};
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

const updateChap2Record = async (pageId, notion, propertyName, propertyValue) => {
    const properties = {};
    properties[propertyName] = propertyValue;

    const updatedRecord = await notion.pages.update({
        page_id: pageId,
        properties: properties,
    });
    console.log('updatedRecord', updatedRecord);

    // TODO - Add logging to the Notion page
//     const timestamp = new Date().toISOString();
//         const logText = `log: user authorized transactionId at ${timestamp}
// node version: ${nodeVersion}
// npm version: ${npmVersion}
// ----------`;

//         // Append log text to the existing content in the Notion page
//         await notion.blocks.children.append({
//             block_id: pageId,
//             children: [
//                 {
//                     object: 'block',
//                     type: 'paragraph',
//                     paragraph: {
//                         rich_text: [
//                             {
//                                 type: 'text',
//                                 text: {
//                                     content: logText,
//                                 },
//                             },
//                         ],
//                     },
//                 },
//             ],
//         });

    return updatedRecord;
};

module.exports = {
    findNotionUser,
    findUserAndChap2Record,
    createChap2Record,
    updateChap2Record,
};