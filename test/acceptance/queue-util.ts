import { SQS } from 'aws-sdk';

const sqs = new SQS({ region: 'eu-west-1' });

export async function upsertQueueIfNotExists(queueName: string, visibilityTimeout: number): Promise<string> {
  const params = {
    Attributes: {
      MessageRetentionPeriod: '60',
      Policy: JSON.stringify({
        Statement: [
          {
            Action: ['sqs:*'],
            Effect: 'Allow',
            Principal: '*',
            Resource: '*',
            Sid: 'allow-attributes',
          },
        ],
        Version: '2012-10-17',
      }),
      VisibilityTimeout: visibilityTimeout.toString(),
    },
    QueueName: queueName,
  };
  const { QueueUrl: queueUrl } = await sqs.createQueue(params).promise();
  if (typeof queueUrl !== 'string') {
    throw new Error('QueueUrl is not a string in response from upsertQueueIfNotExists');
  }
  return queueUrl;
}
