const auth = require('./auth.json')
const discord = require('discord.js')
const winston = require('winston')
const jsonfile = require('jsonfile')
const Rx = require('rxjs')

const {
    Observable,
    of,
    from,
    fromEvent,
    range,
    never,
    timer,
    merge,
    combineLatest
} = require('rxjs');
const {
    defaultIfEmpty,
    mergeMap,
    switchMap,
    map,
    take,
    skip,
    catchError,
    publishLast,
    refCount,
    filter,
    tap
} = require('rxjs/operators');

// logger
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ 
            filename: 'combined.log' 
        }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
})
const log_error = error => {
    logger.error('Unexpected error')
    logger.error(error.message)
    logger.error('Code: ' + error.errno)
}

// save load
const default_settings = {
    hours: 4, 
    channel: null,
    role: null,
    winners: []
}
const load$ = id => from(jsonfile.readFile('./servers/' + id + '.json'))
    .pipe(
        catchError(error => {
            if(error.errno === -2)
                logger.verbose('Server ' + id + ' has no settings saved')
            else
                log_error(error)
            return of()
        }),
        defaultIfEmpty(default_settings)
    )
const save$ = id => json => from(jsonfile.writeFile('./servers/' + id + '.json', json))
    .pipe(
        catchError(error => of(log_error(error)))
    )

// event streams
const client = new discord.Client()
const ready$ = fromEvent(client, 'ready')
    .pipe(
        map(() => client.guilds)
    )
const first_ready$ = ready$
    .pipe(
        take(1)
    )
const error$ = fromEvent(client, 'error')
const leaver$ = fromEvent(client, 'guildMemberRemove')
const message$ = fromEvent(client, 'message')

// message parsing
const filt = msg => find => {
    return msg.content.toLowerCase().startsWith(find)
}
const parse = msg => find => 
    msg.content.toLowerCase().split(find).pop()

// generic message handler
const handler$ = find => message$
    .pipe(
        filter(msg => 
            msg.guild &&
            msg.guild.available &&
            filt(msg)(find)
        ),
        switchMap(msg => arr = 
            combineLatest(
                of(msg),
                of(parse(msg)(find)),
                load$(msg.guild.id)
        )),
        map(arr => obj = {
            msg: arr[0],
            guild: arr[0].guild,
            input: arr[1],
            settings: arr[2]
        })
    )

// lotto commands
const random = members => members.random().id
const get_channel = guild => channel =>  guild.channels.get(channel)
const get_role = guild => role => guild.roles.get(role)
const get_online_winners = guild => winners => 
    winners.filter(winner => guild.members.get(winner))
const update = dict => entry => Object.assign({}, dict, entry)


const go$ = filt => handler$('!lotto go')
    .pipe(
        map(obj => obj = {
            msg: obj.msg,
            guild: obj.guild,
            settings: obj.settings,
            members: obj.guild.members,
            online_winners: get_online_winners(obj.guild)(obj.settings.winners)
        }),
        filter(obj => filt(obj)),
        tap(obj => {
            logger.debug(obj.msg)
            logger.debug(obj.guild)
            logger.debug(JSON.stringify(obj.settings))
            logger.debug('Members:')
            logger.debug('* ' + obj.members.size + ' members.')
            obj.members.forEach(member => logger.debug('* ' + member))
            logger.debug('Winner ids:')
            logger.debug('* ' + obj.settings.winners.length + ' winners.')
            obj.settings.winners.forEach(winner => logger.debug('* ' + winner))
            logger.debug('Winners in guild:')
            logger.debug('* ' + obj.online_winners.length + ' winners in guild.')
            obj.online_winners.forEach(winner => logger.debug('* ' + winner))
        })
    )

const zero_or_one_winner = go$(obj => obj.online_winners.length <= 1)
    .subscribe(obj => {
        const current_winner = obj.online_winners[0]
        const next_winner = random(obj.members)
        const append_list = obj.settings.winners.filter(winner => 
            winner != next_winner && 
            winner != current_winner
        )
        const new_winners = [next_winner].concat(append_list)
        const new_settings = update(obj.settings)({
            winners: new_winners
        })
        logger.debug(JSON.stringify(new_settings))
        
        save$(obj.guild.id)(new_settings)
    })

const more_than_one_winner = go$(obj => obj.online_winners.length > 1)
    .subscribe(obj => {
        const current_winner = obj.online_winners[0]
        const next_winner = obj.online_winners[1]
        const append_list = obj.settings.winners.filter(winner => 
            winner != next_winner && 
            winner != current_winner
        )
        const new_winners = [next_winner].concat(append_list)
        const new_settings = update(obj.settings)({
            winners: new_winners
        })
        logger.debug(JSON.stringify(new_settings))
        
        save$(obj.guild.id)(new_settings)
    })

// lotto settings
handler$('!lotto set hours ')
    .pipe(
        filter(obj => !isNaN(parseInt(obj.input))),
        map(obj => obj = {
            msg: obj.msg,
            guild: obj.guild,
            hours: parseInt(obj.input),
            settings: obj.settings
        }),
        tap(obj => {
            logger.debug(obj.guild)
            logger.debug(obj.msg)
            logger.debug(obj.hours)
            logger.debug(JSON.stringify(obj.settings))
        })
     )
    .subscribe(obj => {
        const new_settings = update(obj.settings)({
            hours: obj.hours
        })
        save$(obj.guild.id)(new_settings)
        
        logger.debug(JSON.stringify(new_settings))
    })

handler$('!lotto set channel ')
    .pipe(
        filter(obj => obj.msg.mentions.channels.first()),
        map(obj => obj = {
            msg: obj.msg,
            guild: obj.guild,
            channel: obj.msg.mentions.channels.first(),
            settings: obj.settings
        }),
        tap(obj => {
            logger.debug(obj.guild)
            logger.debug(obj.msg)
            logger.debug(obj.channel)
            logger.debug(JSON.stringify(obj.settings))
        })
    )
    .subscribe(obj => {
        const new_settings = update(obj.settings)({
            channel: obj.channel.id
        })
        save$(obj.guild.id)(new_settings)
        
        logger.debug(JSON.stringify(new_settings))
    })
    
handler$('!lotto set role ')
    .pipe(
        filter(obj => obj.msg.mentions.roles.first()),
        map(obj => obj = {
            msg: obj.msg,
            guild: obj.guild,
            role: obj.msg.mentions.roles.first(),
            settings: obj.settings
        }),
        tap(obj => {
            logger.debug(obj.guild)
            logger.debug(obj.msg)
            logger.debug(obj.role)
            logger.debug(JSON.stringify(obj.settings))
        })
    )
    .subscribe(obj => {
        const new_settings = update(obj.settings)({
            role: obj.role.id
        })
        save$(obj.guild.id)(new_settings)
        
        logger.debug(JSON.stringify(new_settings))
    })
    
handler$('!lotto get hours')
    .pipe(
        map(obj => obj = {
            msg: obj.msg,
            guild: obj.guild,
            hours: obj.settings.hours
        }),
        tap(obj => {
            logger.debug(obj.guild)
            logger.debug(obj.msg)
            logger.debug(obj.hours)
        })
    )
    .subscribe(obj => {
        obj.msg.reply('hours: ' + obj.hours)
    })
    
handler$('!lotto get channel')
    .pipe(
        map(obj => obj = {
            msg: obj.msg,
            guild: obj.guild,
            channel: get_channel(obj.guild)(obj.settings.channel)
        }),
        tap(obj => {
            logger.debug(obj.guild)
            logger.debug(obj.msg)
            logger.debug(obj.channel)
        })
    )
    .subscribe(obj => {
        obj.msg.reply('channel: ' + obj.channel)
    })
    
handler$('!lotto get role')
    .pipe(
        map(obj => obj = {
            msg: obj.msg,
            guild: obj.guild,
            role: get_role(obj.guild)(obj.settings.role)
        }),
        tap(obj => {
            logger.debug(obj.guild)
            logger.debug(obj.msg)
            logger.debug(obj.role)
        })
    )
    .subscribe(obj => {
        obj.msg.reply('role: ' + obj.role)
    })

handler$('!lotto get all winner')
    .pipe(
        map(obj => obj = {
            msg: obj.msg,
            guild: obj.guild,
            winners: obj.settings.winners
        }),
        tap(obj => {
            logger.debug(obj.msg)
            logger.debug(obj.guild)
            logger.debug(obj.winners)
        })
     )
    .subscribe(obj => {
        const winners = obj.winners.map(winner => '<@' + winner + '>')
        obj.msg.reply('all winners: [' + winners.join(', ') + ']')
    })


handler$('!lotto get winner')
    .pipe(
        map(obj => obj = {
            msg: obj.msg,
            guild: obj.guild,
            winners: get_online_winners(obj.guild)(obj.settings.winners)
        }),
        tap(obj => {
            logger.debug(obj.msg)
            logger.debug(obj.guild)
            logger.debug(obj.winners)
        })
     )
    .subscribe(obj => {
        const winners = obj.winners.map(winner => '<@' + winner + '>')
        obj.msg.reply('winners: [' + winners.join(', ') + ']')
    })

const first_ready = first_ready$
    .subscribe((guilds) => {
        logger.info('Connected.')
        logger.info('Logged in as:')
        logger.info('* ' + client.user.username)
        logger.info('* ' + client.user.id)
        
        logger.verbose('In ' + guilds.size + ' guilds:')
        guilds.forEach(guild => 
            logger.verbose('* ' + guild.name + ' (' + guild.id + ')')
        )
    })

// probably useless function
/*
const load_settings = first_ready$
    .pipe(
        switchMap(guilds => guilds.map(guild => load$(guild.id)))
    )
    .subscribe(jsons => {
        jsons.forEach(json => {
            logger.debug(JSON.stringify(json))
            
        })
    })
*/

const reconnect = ready$
    .pipe(skip(1))
    .subscribe(() => {
        logger.info('Reconnected')
    })

const error = error$
    .subscribe((error) => {
        logger.error(error.message)
    })


//log in
client.login(auth.token)
