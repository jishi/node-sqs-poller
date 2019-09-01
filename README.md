[![Actions Status](https://github.com/jishi/node-sqs-poller/workflows/Node%20CI/badge.svg)](https://github.com/jishi/node-sqs-poller/actions)

# SqsPoller

This is yet another SQS consumption library that came to life because none of the current ones fit my requirements.
It has been battle-tested in production for several years and has been very reliable and also performant. 

This library is designed around the idea that you shouldn't need to concern yourself of the long-polling nature of SQS, 
but rather be able to consider messages to be emitted to your app. Coming from a RabbitMQ background, this design feels
more comfortable to work with for me.

It also needed to support async/promise flow natively, to simplify the implementation and also play nicely with other
async code bases. 

I wanted it to maintain a steady memory footprint, meaning that it should have a maximum amount of in-flight 
messages at any given time. I was worried that this criteria would slow down the message consumption rate, but that 
seems to have been unfounded. 



## Permissions

The required permissions to consume the queue are:

    sqs:ReceiveMessage
    sqs:DeleteMessage
    sqs:ChangeMessageVisibility
    sqs:GetQueueAttributes
    
## Credentials

To simplify this even further, it will use the default credential lookup for the aws-sdk, but there is no possibility 
to specify credentials manually per instance. This was deliberate to keep things simple. This might change if need would 
arise.

Thus, it will look for ENV variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION), or use the default or 
specified profile (AWS_PROFILE). Even though profiles have default regions, the SDKs don't read that. Also, even though 
region is part of the queue URL, you still need to specify it manually. See the
[Node.js documentation](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html)
for more info.
 

## constructor

`new SqsPoller(queue_url, handler, receive_arguments_override = {})`

Handler must return a Promise, otherwise it will reject all messages 
(but still process it). On fulfilled promise, it will delete message 
from queue. Async functions are fine to use.

Example
```
const poller = new SqsPoller('ttps://sqs.eu-central-1.amazonaws.com/123456789012/some-queue', async (msg) => {
    await doSomeAsyncStuff();
});

poller.on('error', (err) => console.error(err));
poller.start();
```

default receive arguments are:

```javascript
{
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20
}
```

`receive_arguments` are the arguments passed to the `AWS.SQS.receiveMessage()` call. See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html#receiveMessage-property
 
An instance of the SqsPoller will have a `start()` and `stop()` function. 

## start() -> void

Returns immediately. Starts polling the queue for messages.

## stop() -> Promise

Returns promise. Resolves when poller has been stopped successfully 
(i.e, stopped processing messages). This immediately aborts any current long-polling to exit as soon as possible.

## simulate(any obj) -> Promise

For testing purposes. To simulate testing you can invoke this function with the expected payload, and it will be 
serialized/deserialized (to simulate a roundtrip via an SQS queue) passed on to the handler function and resolve once 
the handler resolves.

## setMaxBackoffSeconds(int seconds) -> void

Sets the maximum backoff a message will reach during failed attempts. (default: 1200 seconds, 20 minutes);

## handlerTimeout

Property which defaults to 600000 ms, that controls when the poller identifies a stale handler. A stale handler should not exist, it should 
abort within a reasonable time frame to avoid memory leakage. A stale handler also blocks the polling loop, which means that the queue consumption will stop.
The default should be reasonable, and this is mostly exposed for speeding up tests. However, if you have long running tasks for queue messages (+10 minutes)
you can raise the timeout to something higher, if necessary.

## Events
It will emit the following events:

### message

Emits when a message has started processing. Will be called with the raw 
AWS `Message`

### batch-complete

Emits when current batch has been processed. Basically, all messages 
that was received in the current long-polling request. Will emit with a 
status object containing total count of messages in batch, and number of 
successful messages.

```javascript
{
  received: 4,
  successful: 4
}
```

### error

Emits every time an error occurs during polling, processing or deletion 
of messages. If no error handler has been registered, it will throw a 
global exception and cause a crash of the application. It is recommended 
to map this to a logger.

### aborted

Emits every time an AbortedRequestException gets thrown from the underlying SQS instance from the AWS-SDK. Mostly for debugging purposes.

## Backoff

It has a backoff functionality built-in, and automatically activated. The purpose of the backoff is to reduce processing 
frequency on messages that are continously rejected. This saves processing capacity when you have a build-up of messages 
that for obvious reasons fail to process. 

The default configuration is to try a message 3 times using the visibility timeout of the queue (or based on the receive arguments),
and then for each subsequent attempt, double the visibility timeout for each attempt until you reach the max backoff configuration (`setMaxBackoffSeconds()`)

To disable backoff, you need to set the max backoff time to whatever your queue visibility timeout is (e.g 30 seconds);
