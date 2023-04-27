const { promisify } = require('util');
const delay = promisify(setTimeout);
const ytdl = require('ytdl-core');
const fs = require('fs');
const { spawn } = require('child_process');


function makeFolderForLog(log) {
    // check if folder exists
    if(!fs.existsSync(`./extracted/`)) {
        fs.mkdirSync(`./extracted/`);
    }
    if(!fs.existsSync(`./extracted/${log.guild.name} - ${log.guild.id}`)) {
        fs.mkdirSync(`./extracted/${log.guild.name} - ${log.guild.id}`);
    }
    if(!fs.existsSync(`./extracted/${log.guild.name} - ${log.guild.id}/links/`)) {
        fs.mkdirSync(`./extracted/${log.guild.name} - ${log.guild.id}/links/`);
    }
    if(!fs.existsSync(`./extracted/${log.guild.name} - ${log.guild.id}/audio/`)) {
        fs.mkdirSync(`./extracted/${log.guild.name} - ${log.guild.id}/audio/`);
    }
}

function findLinksInLog(log) {
    const files = [];
    // its json, we can just iterate over it
    for (const message of log.messages) {
        if(message.attachments.length > 0) {
            for (const attachment of message.attachments) {
                files.push({
                    type: 'attachment',
                    url: attachment.url,
                    filename: attachment.filename,
                    id: attachment.id
                })
            }
        }
        if(message.embeds.length > 0) {
            for (const embed of message.embeds) {
                files.push({
                    type: 'embed',
                    url: embed.url,
                    filename: embed.title,
                    id: message.id
                })
            }
        }
        let urlRegex = /(https?:\/\/[^\s]+)/g;
        if(message.content.match(urlRegex)) {
            for (const url of message.content.match(urlRegex)) {
                files.push({
                    type: 'link',
                    url: url,
                    id: message.id
                })
            }
        }
    }
    return files;
}

function isLinkAudio(link) {
    let audioFiletypes = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'aiff', 'alac'];
    
    for (const filetype of audioFiletypes) {
        if(link.includes(`discord`)) { // delete this if you want to download non discord attachments, could cause issues
            if(link.endsWith(filetype)) {
                return true;
            }
        }
    }
    return false;
}

function isLinkHostedAudio(link) {
    // chack if its a youtube or soundcloud link
    if(link.includes('youtube') || link.includes('youtu.be')) {
        return {is: true, type: 'youtube'};
    }
    if(link.includes('soundcloud')) {
        return {is: true, type: 'soundcloud'};
    }
    return {is: false, type: null};
}

function pullLog(path) {
    let log = fs.readFileSync(path, 'utf8');
    log = JSON.parse(log);
    return log;
}

function getAllLogsInDir(path) {
    const logs = fs.readdirSync(path);
    // exclude the allLinks.json file
    logs.splice(logs.indexOf('allLinks.json'), 1);
    // exclude the links folder
    logs.splice(logs.indexOf('links'), 1);

    return logs;
}

function grabAllLinksAndFormat(guild) {
    let allLinksinDir = {
        youtube: [],
        soundcloud: [],
        attachment: [],
    };
    let extracted = getAllLogsInDir(`./extracted/${guild.name} - ${guild.id}/links/`);
    for (const file of extracted) {
        let log = pullLog(`./extracted/${guild.name} - ${guild.id}/links/${file}`);
        for(const link of log) {
            if(link.url != null && link.url != undefined && link.url != '') {
                if(isLinkAudio(link.url)) {
                    allLinksinDir.attachment.push(link);
                }
                let hosted = isLinkHostedAudio(link.url);
                if(hosted.is) {
                    allLinksinDir[hosted.type].push(link);
                }
            }
        }
    }
    // check if output file exists
    if(!fs.existsSync(`./extracted/${guild.name} - ${guild.id}/allLinks.json`)) {
        // write all links to a file in the root folder of the guild
        fs.writeFileSync(`./extracted/${guild.name} - ${guild.id}/allLinks.json`, JSON.stringify(allLinksinDir, null, 4));
    }else{console.log('allLinks.json already exists, skipping...');}
}

function getFileExtension(url) {
    const parts = url.split('.');
    const extension = parts[parts.length - 1].split('?')[0];
    return extension;
}

function downloadFile(provider, url, path, callback) {
    const getYoutubeDuration = (url, callback) => {
        const durationChecker = spawn('yt-dlp', ['--get-duration', url]);

        let output = '';
        durationChecker.stdout.on('data', (data) => {
            output += data;
        });

        durationChecker.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        durationChecker.on('close', (code) => {
            if (code === 0) {
                const duration = output.trim().split(':');
                let durationInSeconds = parseInt(duration[0]) * 60;
                if (duration.length > 1) {
                    durationInSeconds += parseFloat(duration[1]);
                }
                callback(null, durationInSeconds);
            } else {
                callback(new Error(`Duration fetch failed with exit code ${code}`));
            }
        });
    };
    
    if (provider === 'youtube') {
        getYoutubeDuration(url, (error, duration) => {
            if (error) {
                callback(error);
                return;
            }

            if (duration > 600) {
                console.error('Video length exceeds 10 minutes. Aborting download.');
                callback(new Error('Video length exceeds 10 minutes.'));
            } else {
                downloadUsingYtDlp(url, path, callback);
            }
        });
    } else {
        downloadUsingYtDlp(url, path, callback);
    }
}

function downloadUsingYtDlp(url, path, callback) {
    const download = spawn('yt-dlp', ['-o', path, url]);

    download.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    download.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    download.on('close', (code) => {
        if (code === 0) {
            console.log('File downloaded successfully!');
            callback(null, 'File downloaded successfully!');
        } else {
            console.error(`Download failed with exit code ${code}`);
            callback(new Error(`Download failed with exit code ${code}`));
        }
    });
}


const rateLimitDelay = 0; // Rate limit delay in milliseconds (1000ms = 1 second)

async function downloadAndSortFiles(jsonData, errorFilePath, guild) {
    const baseOutputPath = `./extracted/${guild.name} - ${guild.id}/audio/`;
    
    function saveError(error) {
        fs.appendFileSync(errorFilePath, `${error}\n`);
    }

    async function saveAndDownload(provider, logIndexFile, item, outputPath) {
        try {
            await new Promise((resolve, reject) => {
                console.log(provider, item.url, outputPath);
                downloadFile(provider, item.url, outputPath, (err, message) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(message);
                    }
                });
            });
            console.log(`Success: ${provider} ${item.id}`);
        } catch (err) {
            console.error("An error occurred:", err);
            saveError(`${provider} ${item.id}: ${err.message}`);
        }

        // Save progress
        fs.writeFileSync(logIndexFile, JSON.stringify({ startIndex: item.index + 1 }));

        // Delay to respect rate limit
        await delay(rateLimitDelay);
    }

    for (const provider of ['attachment', 'soundcloud', 'youtube']) {
        const items = jsonData[provider];
        const logIndexFile = `./extracted/${guild.name} - ${guild.id}/${provider}_progress.json`;

        let startIndex = 0;

        // If progress file exists, get the last known index
        if (fs.existsSync(logIndexFile)) {
            startIndex = JSON.parse(fs.readFileSync(logIndexFile, 'utf8')).startIndex;
        }

        // Iterate from startIndex onwards
        for (let i = startIndex; i < items.length; i++) {
            let item = { ...items[i], index: i };
            if (provider === 'attachment') {
                item.filename = item.url.match(/(\d+\/\d+\/)([^/]+)\.\w+$/)[2];
            }
            const fileName = `${item.filename}%%%${item.id}`;
            let outputPath;
            let fileExtension;

            if (provider === 'attachment') {
                fileExtension = getFileExtension(item.url);
                outputPath = `${baseOutputPath}/${provider}/${fileName}.${fileExtension}`;
            }
            if(provider === 'soundcloud'){
                outputPath = `${baseOutputPath}/${provider}/%(title)s [%(id)s].%(ext)s`;
            }
            if(provider === 'youtube'){
                outputPath = `${baseOutputPath}/${provider}/%(title)s [%(id)s].%(ext)s`;
            }
            
            await saveAndDownload(provider, logIndexFile, item, outputPath);
        }
    }
}

function archive() {
    let unparsed = getAllLogsInDir('./logs');
    for (const file of unparsed) {
        let log = pullLog(`./logs/${file}`);
        makeFolderForLog(log);

        // check if the output file exists
        if(fs.existsSync(`./extracted/${log.guild.name} - ${log.guild.id}/links/${log.channel.name} - ${log.channel.id}.json`)) {
            // if it does, skip this log
            continue;
        }

        let links = findLinksInLog(log);
        // write links to the logs' folder, links is a bunch of arrays with 1 json object in them, format them nicely
        fs.writeFileSync(`./extracted/${log.guild.name} - ${log.guild.id}/links/${log.channel.name} - ${log.channel.id}.json`, JSON.stringify(links, null, 4));
    }

    // grab all links and format them from the last given guild
    let guild = pullLog(`./logs/${unparsed[unparsed.length - 1]}`).guild;
    grabAllLinksAndFormat(guild);

    // download all files
    let allLinks = JSON.parse(fs.readFileSync(`./extracted/${guild.name} - ${guild.id}/allLinks.json`, 'utf8'));
    downloadAndSortFiles(allLinks, `./extracted/${guild.name} - ${guild.id}/errors.txt`, guild);
}


archive();