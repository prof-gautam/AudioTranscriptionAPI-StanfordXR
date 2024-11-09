const AWS = require('aws-sdk');
const https = require('https');
const transcribeService = new AWS.TranscribeService();

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));
        if (!event.body) {
            return errorResponse('Request body is missing.');
        }
        
        let audioFileUrl;
        try {
            const requestBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
            audioFileUrl = requestBody.audioFileUrl;
        } catch (parseError) {
            return errorResponse('Invalid JSON format in request body.');
        }
        if (!audioFileUrl) {
            return errorResponse('Missing audioFileUrl in request.');
        }

        const jobName = `transcription-job-${Date.now()}`;
        console.log(`Starting transcription job with name: ${jobName}`);

        // Step 1: Start the transcription job with corrected settings
        await transcribeService.startTranscriptionJob({
            TranscriptionJobName: jobName,
            LanguageCode: 'en-US',
            Media: { MediaFileUri: audioFileUrl },
            Settings: {
                ShowSpeakerLabels: false,
                ChannelIdentification: false
            }
        }).promise();

        // Step 2: Optimized polling strategy
        const maxAttempts = 20;
        let jobStatus = 'IN_PROGRESS';
        let delay = 1000;  // Initial delay of 1 second
        const maxDelay = 5000;   // Max delay of 5 seconds

        for (let attempt = 0; attempt < maxAttempts && jobStatus === 'IN_PROGRESS'; attempt++) {
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Parallel processing: Start preparing the next poll while waiting for the current one
            const [data] = await Promise.all([
                transcribeService.getTranscriptionJob({ TranscriptionJobName: jobName }).promise(),
                new Promise(resolve => setTimeout(resolve, delay))
            ]);

            jobStatus = data.TranscriptionJob.TranscriptionJobStatus;
            
            if (jobStatus === 'COMPLETED') {
                console.log("Transcription job completed.");
                const transcript = await Promise.race([
                    fetchTranscriptFromHttps(data.TranscriptionJob.Transcript.TranscriptFileUri),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Transcript fetch timeout')), 5000))
                ]);
                return successResponse('Transcription job completed successfully.', transcript);
            } else if (jobStatus === 'FAILED') {
                console.error("Transcription job failed:", data.TranscriptionJob.FailureReason);
                return errorResponse('Transcription job failed.', data.TranscriptionJob.FailureReason);
            }
            
            delay = Math.min(delay * 1.25, maxDelay);
        }
        
        console.error("Transcription job timed out.");
        return errorResponse('Transcription job timed out.');
    } catch (error) {
        console.error("Error processing transcription job:", error);
        return errorResponse('Error processing transcription job.', error.message);
    }
};

async function fetchTranscriptFromHttps(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            timeout: 5000
        }, (response) => {
            response.setMaxListeners(20);
            
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                try {
                    const data = Buffer.concat(chunks).toString();
                    const parsedData = JSON.parse(data);
                    resolve(parsedData.results.transcripts[0].transcript);
                } catch (error) {
                    reject(new Error('Failed to parse transcript JSON'));
                }
            });
        });

        request.on('error', (error) => {
            reject(new Error('Failed to fetch transcript from HTTPS URL'));
        });

        request.on('timeout', () => {
            request.destroy();
            reject(new Error('Request timed out'));
        });
    });
}

function successResponse(message, data) {
    return {
        statusCode: 200,
        body: JSON.stringify({ message, transcription: data })
    };
}

function errorResponse(message, error = '') {
    return {
        statusCode: 500,
        body: JSON.stringify({ message, error })
    };
}