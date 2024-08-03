import { flatten } from "flat";
import { stripHtml } from "string-strip-html";
import { EnqueuedTask, Meilisearch, TaskStatus } from "meilisearch";
import { MeilisearchTaskResult } from "./models";

const flattenAndStripHtml = (object : any) : any =>
{
    // Flatten the object, so we can easily iterate the properties.
    const flattenedObject = flatten(object) as any;

    for(const key of Object.keys(flattenedObject))
    {
        // Delete properties that are subproperties of a content type and aren't interested in including in a meilisearch document.
        if ((key.includes("blocks") || key.includes("content")) && !(key.endsWith(".title") || key.endsWith(".content") || key.endsWith(".text") || key.endsWith(".caption") || key.endsWith(".description") || key.endsWith(".summary")))
        {
            delete flattenedObject[key];
            continue;
        }

        // Delete the property when the value is null.
        if (flattenedObject[key] == null)
        {
            delete flattenedObject[key];
            continue;
        }
        
        // We're only interested in stripping html from certain properties (any property that could potentially contain html).
        if (!key.endsWith("content") && !key.endsWith("description") && !key.endsWith("text") && !key.endsWith("summary") && !key.endsWith("caption")) continue;
        flattenedObject[key] = stripHtml(flattenedObject[key]).result;
    }
    return flattenedObject;
};

const sleep = (ms : number) =>
{
    return new Promise((resolve) =>
    {
        setTimeout(resolve, ms);
    });
};

const waitForMeilisearchTask = (client: Meilisearch, task: EnqueuedTask) =>
{
    return new Promise<MeilisearchTaskResult>(async (resolve) =>
    {
        let counter = 0;
        let taskStatus: string = TaskStatus.TASK_ENQUEUED;
        let taskError = "";

        while(taskStatus !== TaskStatus.TASK_SUCCEEDED && taskStatus !== TaskStatus.TASK_FAILED && taskStatus !== TaskStatus.TASK_CANCELED)
        {
            // Get latest status of task.
            const taskInfo = await client.getTask(task.taskUid);
            taskStatus = taskInfo.status;
            if (taskStatus === TaskStatus.TASK_FAILED) taskError = `${taskInfo.error?.code}: ${taskInfo.error?.message}`

            // When we've tried 5 times, exit.
            if (counter === 5) break;

            // Wait 5 seconds before trying again.
            await sleep(5000);

            counter++;
        }

        // When the delete operation failed, send admin a notification.
        if (taskStatus === TaskStatus.TASK_FAILED)
        {
            resolve(new MeilisearchTaskResult(false, taskStatus));
        }

        resolve(new MeilisearchTaskResult(true, ""));
    });
};

export { flattenAndStripHtml, sleep, waitForMeilisearchTask };