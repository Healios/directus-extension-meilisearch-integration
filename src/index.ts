import { defineHook } from "@directus/extensions-sdk";
import { MeiliSearch } from "meilisearch";
import { MeilisearchSettingsTable } from "./tables";
import { flattenAndStripHtml, waitForMeilisearchTask } from "./helpers";
import { MeilisearchSettings } from "./models";

export default defineHook(async ({ init, action }, { logger, services, getSchema }) =>
{
	const TABLE_NAME = "meilisearch_settings";
    const { CollectionsService, ItemsService } = services;
    const schema = await getSchema();

	init("cli.before", ({ program }) =>
	{
		program.command("meilisearch:reindex")
				.description("Goes through each collection and updates each collection's index.")
				.action(async () =>
				{
					const schema = await getSchema();
					const collectionService = new CollectionsService({ schema });
					const collections = await collectionService.readByQuery();

					// Check wether the 
					if (collections.find((collection: { collection: string }) => collection.collection === TABLE_NAME) === undefined)
					{
						logger.info("Unable to reindex collections. You must first setup the extension.");
						return;
					}

					// Get meilisearch settings.
					const settingsService = new ItemsService("meilisearch_settings", { schema });
					const entity = await settingsService.readOne("1");
					const meilisearchSettings = new MeilisearchSettings(entity);

					// Exit early, when the integration hasn't been setup.
					if (meilisearchSettings.Host.length === 0 || meilisearchSettings.Key.length === 0 || meilisearchSettings.CollectionsConfiguration.length === 0) return;

					// Create the meilisearch client.
					const client = new MeiliSearch({ host: meilisearchSettings.Host, apiKey: meilisearchSettings.Key });

					await Promise.all(meilisearchSettings.CollectionsConfiguration.map(async (configuration) =>
					{
						logger.info(`Updating index for collection ${configuration.Collection}`);

						// Get index.
						let index = null;
						try
						{
							index = await client.getIndex(configuration.Collection);
						}
						catch
						{
							// When the index doesn't exist, try to create it.
							const task = await client.createIndex(configuration.Collection);
							const taskResult = await waitForMeilisearchTask(client, task);
							if (!taskResult.Success)
							{
								logger.warn(`Unable to create index for collection ${configuration.Collection}`);
								logger.warn(taskResult.Message);
							}
							else
							{
								index = await client.getIndex(configuration.Collection);
							}
						}
						if (index == null) return;

						// Create items service.
						const itemsService = new ItemsService(configuration.Collection, { schema: schema });

						// Get entities from database.
						const pageSize = 100;
						for(let offset = 0;;offset += pageSize)
						{
							const entities = await itemsService.readByQuery({ fields: configuration.Fields, limit: pageSize, offset: offset }) as any;
							const flattenedEntities = [];
							
							if (!entities || !entities.length) break;

							for(const entity of entities)
								flattenedEntities.push(flattenAndStripHtml(entity));

							await index.updateDocuments(flattenedEntities);

							logger.info(`Updated ${flattenedEntities.length} entities in meilisearch index ${configuration.Collection}.`);
						}
					}));

					logger.info("Finished reindexing.")
				});
	});

	action("server.start", async () =>
	{
		const collectionService = new CollectionsService({ schema });
		const collections = await collectionService.readByQuery();

		// When the integration table doesn't exist, create it, and when it does, update it.
		if (collections.find((collection: { collection: string }) => collection.collection === TABLE_NAME) === undefined)
		{
			await collectionService.createOne(MeilisearchSettingsTable);
			logger.info("directus-extension-meilisearch-integration: Meilisearch Settings table created.");
			logger.info("directus-extension-meilisearch-integration: To activate the extension fill out the settings and restart Directus.");
			logger.info("directus-extension-meilisearch-integration: Exiting.");
			return;
		}
		else
		{
			await collectionService.updateOne(TABLE_NAME, MeilisearchSettingsTable);
			logger.info("directus-extension-meilisearch-integration: Meilisearch Settings table updated.");
		}

		// Get meilisearch settings.
		const settingsService = new ItemsService("meilisearch_settings", { schema });
		const entity = await settingsService.readOne("1");
		const meilisearchSettings = new MeilisearchSettings(entity);

		// Exit early, when the integration hasn't been setup.
		if (meilisearchSettings.Host.length === 0 || meilisearchSettings.Key.length === 0 || meilisearchSettings.CollectionsConfiguration.length === 0) return;
		logger.info("directus-extension-meilisearch-integration: Integration status OK.");

		// Create the meilisearch client.
		const client = new MeiliSearch({ host: meilisearchSettings.Host, apiKey: meilisearchSettings.Key });

		// Setup a create, update and delete action for each configured collection.
		for(const configuration of meilisearchSettings.CollectionsConfiguration)
		{
			action(`${configuration.Collection}.items.create`, async (meta, context) =>
			{
				// Create items service.
				const itemsService = new ItemsService(configuration.Collection, { schema: context.schema, accountability: context.accountability });

				// Get entity id.
				const entityId = meta.key;
				
				// Get entity from database.
				const entities = await itemsService.readMany([entityId], { fields: configuration.Fields, filter: configuration.Filter });
				if (entities.length === 0) return;
				const entity = entities[0];

				// Get index.
				const index = client.index(configuration.Collection);

				// Add meilisearch document.
				const flattenedEntity = flattenAndStripHtml(entity);
				const task = await index.addDocuments(flattenedEntity);

				// Check wether the add operation succeeded.
				// const taskResult = await waitForMeilisearchTask(client, task);
				// if (!taskResult.Success)
				// {
				// 	// Send notification to selected users.
				// 	const notificationsService = new NotificationsService({ schema });
				// 	notificationsService.createOne({ collection: configuration.Collection, recipient: "", message: taskResult.Message });
				// 	return;
				// }
				
				logger.info(`Added entity with id: "${entityId}" to meilisearch.`);
			});

			action(`${configuration.Collection}.items.update`, async (meta, context) =>
			{
				// Create items service.
				const itemsService = new ItemsService(configuration.Collection, { schema: context.schema, accountability: context.accountability });

				// Get entity id.
				const entityId = meta.keys[0];
				
				// Get index.
				const index = client.index(configuration.Collection);

				// Get entity from database.
				const entities = await itemsService.readMany([entityId], { fields: configuration.Fields, filter: configuration.Filter });
				if (entities.length === 0) {
					// The entity no longer conforms to the specified filter, so we remove it from meilisearch.
					await index.deleteDocument(entityId);
					return;
				}
				const entity = entities[0];

				// Add meilisearch document.
				const flattenedEntity = flattenAndStripHtml(entity);
				const task = await index.updateDocuments(flattenedEntity);

				// Check wether the update operation succeeded.
				// const taskResult = await waitForMeilisearchTask(client, task);
				// if (!taskResult.Success)
				// {
				// 	// Send notification to selected users.
				// 	const notificationsService = new NotificationsService({ schema });
				// 	notificationsService.createOne({ collection: configuration.Collection, recipient: "", message: taskResult.Message });
				// 	return;
				// }

				logger.info(`Updated entity with id: "${entityId}" in meilisearch.`);
			});

			action(`${configuration.Collection}.items.delete`, async (meta, context) =>
			{
				// Get entity id.
				const entityId = meta.keys[0];
				
				// Get index.
				const index = client.index(configuration.Collection);
				
				// Delete meilisearch document.
				const task = await index.deleteDocument(entityId);

				// Check wether the delete operation succeeded.
				// const taskResult = await waitForMeilisearchTask(client, task);
				// if (!taskResult.Success)
				// {
				// 	// Send notification to selected users.
				// 	const notificationsService = new NotificationsService({ schema });
				// 	notificationsService.createOne({ collection: configuration.Collection, recipient: "", message: taskResult.Message });
				// 	return;
				// }

				logger.info(`Deleted entity with id: "${entityId}" in meilisearch.`);
			});
		}
	});
});