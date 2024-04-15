import { pipeline } from '@xenova/transformers';
import PoolConnectorClient from './PoolConnectorClient.js';

const supportedModels = (process.env.SUPPORTED_MODELS || "*").split(",");
const supportedPipelines = (process.env.SUPPORTED_PIPELINES || "*").split(",");
const instanceKeepAliveTimeout= Number(process.env.INSTANCE_KEEP_ALIVE_TIMEOUT || 1000*60*10);
const announceTimeout = Number(process.env.ANNOUNCE_TIMEOUT || 1000*60*5);
const instances = {};
let nextNodeAnnouncementTimestamp = 0;

const templates = [
    {
        nextAnnounceTimestamp: 0,
        template: {
            kind: 5003,
            tags: [
                ["name", "TransformerJS Action"],
                ["param", "run-on", "openagents/transformersjs"],
                ["param", "pipeline", "%INPUT_PIPELINE_NAME%"],
                ["param", "model", "%INPUT_MODEL_NAME%"],
                ["about", "An action that runs a transformer.js model"],
                ["i", "%INPUT%_DATA"],
                ["tos", ""],
                ["privacy", ""],
                ["author", ""],
                ["web", ""],
                ["picture", ""],
            ],
        },
    },
];
async function execute(pipelineName, modelName, inputs, log, accept){
    const QUANTIZE = (process.env.QUANTIZE || "true") == "true";

    if(!pipelineName||(!supportedPipelines.includes("*") && supportedPipelines.includes(pipelineName) === false)){
        throw new Error("Pipeline not supported");
    }

    if (!modelName || (!supportedModels.includes("*") && supportedModels.includes(modelName) === false)){
        throw new Error("Model not supported");
    }

    if(!inputs){
        throw new Error("No input provided");
    }
    await accept();
    const instanceName = `${pipelineName}_${modelName}`;
    if(!instances[instanceName]){
        log("Loading "+pipelineName+" "+modelName);
        const t=Date.now();
        instances[instanceName] = {
            pipeline:await pipeline(pipelineName, modelName,{
                quantized: QUANTIZE
            }),
            timestamp: Date.now()
        }
        log("Loaded "+pipelineName+" "+modelName+" in "+(Date.now()-t)+"ms");
    }

    const instance = instances[instanceName];
    instance.timestamp = Date.now();
    
    log("Running "+pipelineName+" "+modelName);
    const t=Date.now();
    const out = await instance.pipeline(...JSON.parse(inputs));
    log("Executed "+pipelineName+" "+modelName+" in "+(Date.now()-t)+"ms");

    const stringifiedOut = JSON.stringify(out, null, 2);
    console.log(stringifiedOut);

    return stringifiedOut;
}



async  function runJobs(conn){
    const pendingJobs=await conn.r(
         conn.getPendingJobs({
            filterByRunOn: "openagents/transformersjs",
        })
    );

    for(const job of pendingJobs.jobs){
        const inputs = job.input;
        const input = inputs[0];

        const inputData = input.data;
        const pipeline = job.param.find((param) => param.key == "pipeline")?.value[0] || "";
        const model = job.param.find((param) => param.key == "model")?.value[0] || "";
        const maxExecutionTime = job.maxExecutionTime;
        const expiration = Math.min(Date.now() + maxExecutionTime, job.expiration);
        
        execute(pipeline, model, inputData,(tx)=>{
            console.log(tx);
            conn.logForJob({
                jobId: job.id,
                log: tx
            }) 
        },()=>{
            return conn.r(conn.acceptJob({ jobId: job.id }));
        }).then((output)=>{
            conn.completeJob({
                jobId: job.id,
                output
            })
        }).catch((e)=>{
            console.error("Error running job", e);
            conn.cancelJob({
                jobId: job.id,
                reason: e.toString(),
            });
        });

    }
}



async function announce(conn){
    const ICON_URL = process.env.ICON_URL || "";
    const NAME = process.env.NAME || "TransformerJS Node";
    const DESCRIPTION = process.env.DESCRIPTION || "A node that runs transformers.js models and pipelines";
    if (Date.now() >= nextNodeAnnouncementTimestamp) {
        const res = await conn.r(
            conn.announceNode({
                iconUrl: ICON_URL,
                name: NAME,
                description: DESCRIPTION
            })
        );
        const refreshTime = res.refreshInterval;
        nextNodeAnnouncementTimestamp = Date.now() + refreshTime;
    }
    for (const template of templates) {
        if (Date.now() >= template.nextAnnounceTimestamp) {
            const res = await conn.r(conn.announceEventTemplate({
                eventTemplate: JSON.stringify(template.template, null, 2),
            }));
            const refreshInterval = res.refreshInterval;
            template.nextAnnounceTimestamp = Date.now() + refreshInterval;
        }
    }
}

async function evictExpired(){
    const now = Date.now();
    for(const [key, value] of Object.entries(instances)){
        if(now - value.timestamp > instanceKeepAliveTimeout){
            delete instances[key];
        }
    }
}



async function main(){
    const IP = process.env.POOL_ADDRESS || "127.0.0.1";
    const PORT = Number(process.env.POOL_PORT || 5000);

    const CA_CRT_PATH = process.env.POOL_CA_CRT || "";
    const CLIENT_CRT_PATH = process.env.POOL_CLIENT_CRT || "";
    const CLIENT_KEY_PATH = process.env.POOL_CLIENT_KEY || "";

    const CA_CRT = (CA_CRT_PATH && Fs.existsSync(CA_CRT_PATH)) ? Fs.readFileSync(CA_CRT_PATH) : undefined;
    const CLIENT_CRT =
        CLIENT_CRT_PATH && Fs.existsSync(CLIENT_CRT_PATH) ? Fs.readFileSync(CLIENT_CRT_PATH) : undefined;
    const CLIENT_KEY =
        CLIENT_KEY_PATH && Fs.existsSync(CLIENT_KEY_PATH) ? Fs.readFileSync(CLIENT_KEY_PATH) : undefined;
    const poolConnector = new PoolConnectorClient(IP, PORT, CA_CRT, CLIENT_KEY, CLIENT_CRT);

    const _expiration_loop=async ()=>{
        try{
            await evictExpired();
        }catch(e){
            console.error(e);
        }
        setTimeout(_expiration_loop, 1000);
    }; _expiration_loop();

    const _main_loop=async ()=>{
        try{
            await runJobs(poolConnector);
        }catch(e){
            console.error(e);
        }
        setTimeout(_main_loop, 10);
    }; _main_loop();

    const _announce_loop=async ()=>{    
        try{
            await announce(poolConnector);
        }catch(e){
            console.error(e);
        }
        setTimeout(_announce_loop, announceTimeout);
    }; _announce_loop();
}

main();