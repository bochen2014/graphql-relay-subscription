import 'babel-polyfill';

import chai, { expect } from 'chai';
import dirtyChai from 'dirty-chai';
import { graphql, GraphQLObjectType, GraphQLSchema, GraphQLString }
  from 'graphql';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { graphqlSubscribe, subscriptionWithClientId } from '../src';

chai.use(dirtyChai);
chai.use(sinonChai);

describe('default resolution', () => {
  let schema;

  beforeEach(() => {
    schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          dummy: { type: GraphQLString },
        },
      }),
      subscription: new GraphQLObjectType({
        name: 'Subscription',
        fields: {
          foo: subscriptionWithClientId({
            name: 'FooSubscription',
            outputFields: {
              value: { type: GraphQLString },
            },
            subscribe: (input, context) => {
              context.subscribeSpy();
            },
          }),
        },
      }),
    });
  });

  it('should call subscribe', async () => {
    const subscribeSpy = sinon.spy();

    const result = await graphqlSubscribe({
      schema,
      query: `
        subscription {
          foo(input: {}) {
            value
          }
        }
      `,
      context: { subscribeSpy },
    });

    expect(subscribeSpy).to.have.been.called();
    expect(result.data).to.eql({ foo: null });
  });

  it('should get payload', async () => {
    const result = await graphql(
      schema,
      `
        subscription {
          foo(input: {}) {
            value
          }
        }
      `,
      { value: 'bar' },
    );

    expect(result.data).to.eql({
      foo: {
        value: 'bar',
      },
    });
  });
});

describe('real-life example', () => {
  let schema;

  beforeEach(() => {
    schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          dummy: { type: GraphQLString },
        },
      }),
      subscription: new GraphQLObjectType({
        name: 'Subscription',
        fields: {
          foo: subscriptionWithClientId({
            name: 'FooSubscription',
            inputFields: () => ({
              arg: { type: GraphQLString },
            }),
            outputFields: () => ({
              value: { type: GraphQLString },
              arg: { type: GraphQLString },
            }),
            subscribe: async ({ arg }, context) => {
              const { subscript2RabbitMQ } = context;
              subscript2RabbitMQ();
              return { value: 'initial-value', arg }
            },
            getPayload: async ({ value }, { arg }) => ({ value, arg }),
          }),
        },
      }),
    });
  });

  it('real world example', async () => {
    var io = require('socket.io')(new require('http').Server(new require('express').default()))
    io.on('connection', socket => {
      socket.on('graphql:subscription', request => {
        const { query, variables } = request;
        /*
        query =  `subscription ($input: FooSubscriptionInput!) {
                foo(input: $input) {
                  value
                  arg
                  clientSubscriptionId
                }
              }
           `
          variables= {input: {
                          arg: 'bar',
                          clientSubscriptionId: 'client-generated-subscription-id',
                          },
                      }
         */
        const initial_payload = await graphqlSubscribe({
          schema,
          query,
          context: {
            subscript2RabbitMQ: () => {
              //****************************************************************/
              // handle rabbit-mq changes and send udpated payload to client
              pubSub.subscript('amqp.races', msg => {
                     pubSub.subscribe('amqp.races', msg => {
                      const updated_Payload = await graphql(schema, query, msg.updatedVal/*e.g { value: 'rabbitmq-updated'}*/, null/*no context this time*/, variables);
                      socket.emit('graphql:subscription', updated_payload);
                      expect(updated_payload.data).to.eql({
                            foo: {
                              value: 'rabbitmq-updated',
                              arg: 'bar',
                              clientSubscriptionId: 'client-generated-subscription-id',
                            },
                          });
                     });
              });
              //****************************************************************/
            }
          },
          variables,
        });

        socket.emit('graphql:subscription', initial_payload)
      })
    })

    //verify that client will receive a payload with clientSubscriptId(which client created in the first place)
    // and initial payload value;
    expect(initial_payload.data).to.eql({
      foo: {
        value: 'initial-value',
        arg: 'bar',
        clientSubscriptionId: 'client-generated-subscription-id',
      },
    });



  });
});
