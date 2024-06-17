import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import knexModule from 'knex';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { GraphQLError } from 'graphql';
import WebSocket, { WebSocketServer } from 'ws';
import * as dotenv from 'dotenv';
import { count } from 'console';
dotenv.config();


const knex = knexModule({
  client: 'sqlite3',
  connection: {
    filename: './mydb.sqlite',
  },
  useNullAsDefault: true,
});

const wss = new WebSocketServer({ port: 3000 });

async function createUsersTable(): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('username', 255).notNullable().unique();
    table.string('password', 255).notNullable()
    table.integer('signInCount');
    console.log('create table');
  });
}

//createUsersTable(); // only once

async function getTheSum() {
  const SumOfLogIns = await knex.raw('SELECT SUM(signInCount) AS summ FROM users').then(data => data[0].summ);
  return SumOfLogIns;
}

async function updateUser(user) {
  user.signInCount +=1;
  const userUpdated = await knex('users').where({id: user.id}).update({signInCount: user.signInCount},['*']).then(data => data);
}

async function createUser(username, password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await knex('users').insert({ username, password: hashedPassword, signInCount: 0 }, ['*']);
    return newUser[0]; 
}

async function logIn (username, password) {
  const users:{id: string; username: string; password: string; signInCount: number}[] = await knex('users').select().where({username});
  if (users.length < 0) {
    throw new GraphQLError('User is not authenticated', {
      extensions: {
        code: 'UNAUTHENTICATED',
        http: { status: 401 },
      }
    });
  }
  if(users.length === 1) {
    let user = users[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      throw new GraphQLError('Wrong password', {
        extensions: {
          code: 'WRONGPASSWORD',
          http: { status: 401 },
        }
      });
    }

    await updateUser(user);
    const sumOfLogIns = await getTheSum();

    //console.log("SumOfLogIns: ",SumOfLogIns) 

    const token = await jwt.sign({ userId: user.id }, process.env.SECTRET_STRING, {
      expiresIn: '1h',
    });

    wss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({count: sumOfLogIns}));
      }
    });
    
    return {
      username: user.username,
      userId: user.id,
      signInCount: user.signInCount,
      token
    };
  }
  throw new GraphQLError('Wrong password', {
    extensions: {
      code: 'LOGINNOTPOSSIBLE',
      http: { status: 401 },
    }
  });
}



const typeDefs = `#graphql
  type User {
    id: ID!
    username: String!
    password: String!
    signInCount: Int
  }

  type LogInResult {
    userId: ID
    username: String
    token: String
    signInCount: Int
  }

  type Query {
    user: User!
    logIn(username: String!, password: String!): LogInResult
    createUser(username: String!, password: String!): User
    sumOfLogIns: Int
  }
`;


const resolvers = {
  Query: {
    user: async (_, { id }) => {
      const user = await knex.select().from('users').where('id', id);
      return user;
    },
    logIn: async (_, {username, password}) => {
      let obj = await logIn(username, password);
      return obj;
    },
    createUser: async (_, { username, password } ) => {
      let user = await createUser(username, password);
       return user;
    },
    sumOfLogIns: async (_,{}, context) => {
      console.log(context.userId);
      if(context.userId){
        let sum = await getTheSum();
        return sum;
      }
      throw new GraphQLError('Not Authorized', {
        extensions: {
          code: 'NOTAUTHORIZED',
          http: { status: 401 },
        }
      });
    }
  } 
};

function getUserId(req){
  //neet to pass this header in the front
  let token = req.header('authorization');
  //console.log("token", token);
  if(token ===  '""' || !token) {
    return null;
  }
  token = token.substring(1,token.length -1);
  const decoded = jwt.verify(token, process.env.SECTRET_STRING);
  return decoded.userId;
  
}




// wss.on('connection', function connection(ws) {
//   ws.on('error', console.error);

//   ws.on('message', 
//   });
// });


const server = new ApolloServer({
  typeDefs,
  resolvers,
});


const { url } = await startStandaloneServer(server, {
  context: async ({req}) => ({
    userId: getUserId(req),
  }),
  listen: { port: 4001 },
});





  console.log(`🚀  Server ready at: ${url}`);


