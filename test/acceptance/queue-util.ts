import { SQS } from 'aws-sdk';

const sqs = new SQS({ region: 'eu-west-1' });

export async function upsertQueueIfNotExists(queue_name: string, visibility_timeout: number): Promise<string> {
  const params = {
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
  };
  const { QueueUrl: queue_url } = await sqs.createQueue(params).promise();
  if (typeof queue_url !== 'string') {
    throw new Error('QueueUrl is not a string in response from upsertQueueIfNotExists');
  }
  return queue_url;
}
