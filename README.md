# NOTE! Versioning

This project releases a new version from master using MAJOR.BUILDCOUNT.0 as versioning scheme automatically. If you do breaking changes, 
you should bump major version in package.json manually!

Example: if package.json contains "1.0.0", and build count is 123, the published npm version will result in 1.123.0.
if package.json contains "2.0.0", and build count is 127, the published npm version will result in 2.127.0.

# SqsPoller

## constructor

`new SqsPoller(queue_url, handler, receive_arguments_override = {}, region = 'eu-west-1')`

Handler must return a Promise, otherwise it will reject all messages 
(but still process it). On fulfilled promise, it will delete message 
from queue.

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

