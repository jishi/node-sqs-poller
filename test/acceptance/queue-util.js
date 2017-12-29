import AWS from 'aws-sdk';
const sqs = new AWS.SQS({ region: 'eu-west-1' });

export default function upsert_queue_if_not_exists(queue_name, visibility_timeout) {
  return sqs.createQueue({
        QueueName: queue_name,
        Attributes: {
          MessageRetentionPeriod: '60',
          VisibilityTimeout: visibility_timeout.toString(),
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'allow-attributes',
                Effect: 'Allow',
                Principal: '*',
                Action: ['sqs:*'],
                Resource: '*',
              },
            ],
          }),
        },
      })
      .promise()
      .then(data => data.QueueUrl);
}
