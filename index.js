const AWS = require('aws-sdk');
const transcribeService = new AWS.TranscribeService();

exports.handler = async (event) => {
    try {
        const audioFileUrl = 's3://audiobucketstanfordxr/test_audio.mp3';
        
        const params = {
            TranscriptionJobName: `transcription-job-${Date.now()}`,
            LanguageCode: 'en-US',
            Media: {
                MediaFileUri: audioFileUrl
            },
            OutputBucketName: 'audiobucketstanfordxr'
        };

        const data = await transcribeService.startTranscriptionJob(params).promise();
        const jobName = data.TranscriptionJob.TranscriptionJobName;
        const status = data.TranscriptionJob.TranscriptionJobStatus;

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Transcription job started successfully. Status: ${status}`,
                jobName: jobName
            })
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Failed to start transcription job',
                error: error.message
            })
        };
    }
};
