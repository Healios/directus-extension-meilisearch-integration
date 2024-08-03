class CollectionConfiguration
{
    constructor(collection: string, filter: object, fields: string[])
    {
        this.Collection = collection;
        this.Filter = filter;
        this.Fields = fields;
    }

    public Collection: string;

    public Filter: object;

    public Fields: string[];
}

export class MeilisearchSettings
{
    constructor(data: object)
    {
        this.Host = (data as any).host;
        this.Key = (data as any).api_key;

        const configurationData = (data as any).collections_configuration;
        this.CollectionsConfiguration = configurationData.map((config: any) => new CollectionConfiguration(config.collection, config.filter, config.fields));
    }

    public Host: string;

    public Key: string;

    public CollectionsConfiguration: CollectionConfiguration[];
}

export class MeilisearchTaskResult
{
    constructor(success: boolean, message: string)
    {
        this.Success = success;
        this.Message = message;
    }

    public Success: boolean;

    public Message: string;
}