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
    mergeMap,
    switchMap,
    map,
    take,
    skip,
    catchError,
    publishLast,
    refCount,
    filter,
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
const load$ = id => from(jsonfile.readFile('./servers/' + id + '.json'))
    .pipe(
        catchError(error => {
            if(error.errno === -2) {
                logger.info('Server ' + id + ' has no settings saved')
            } else {
                log_error(error)
            }
            return of(null)
        }),
        publishLast(),
        refCount()
    )
const save$ = id => json => from(jsonfile.writeFile('./servers/' + id + '.json', json))
    .pipe(catchError(error => of(log_error(error))))
    
const edit_prop = prop => value => obj => ({...obj, [prop]: value})

const default_settings = {
    hours: 4, 
    channel: null,
    role: null,
    winners: []
}

// event streams
const client = new discord.Client()

const ready$ = fromEvent(client, 'ready')
    .pipe(map(() => client.guilds))
const first_ready$ = ready$
    .pipe(take(1))
const error$ = fromEvent(client, 'error')
const leaver$ = fromEvent(client, 'guildMemberRemove')
const message$ = fromEvent(client, 'message')

// message parsing
const filt = msg => find => {
    return msg.content.toLowerCase().startsWith(find)
}
const parse = msg => find => 
    msg.content.toLowerCase().split(find).pop()

// generic handler
const handler$ = find => message$
    .pipe(
        filter(msg => filt(msg)(find)),
        switchMap(msg => 
            combineLatest(
                of(msg),
                of(parse(msg)(find)),
                load$(msg.guild.id)
        )),
        switchMap(data => combineLatest(
                of(data[0]),
                of(data[1]),
                of(data[2] ? data[2] : default_settings)
        ))
    )

// can add filters here (hours != NaN etc)
handler$('!lotto set hours ')
    .subscribe(data => {
        const msg = data[0]
        const hours = parseInt(data[1])
        const settings = data[2]
        
        if(isNaN(hours)) {
            msg.reply('NaN given. Hours not set.')
            return
        }
        
        logger.debug(msg)
        logger.debug(hours)
        logger.debug(JSON.stringify(settings))
        
        const new_settings = Object.assign({}, settings, {
            hours: hours
        })
        logger.debug(JSON.stringify(new_settings))
        save$(msg.guild.id)(new_settings)
    })

handler$('!lotto set channel ')
    .subscribe(data => {
        const msg = data[0]
        const channel = data[1]
        const settings = data[2]
        
        if(msg.mentions.channels.first() === undefined) {
            msg.reply('Unable to find channel mention.')
            return
        }
        
        logger.debug(msg)
        logger.debug(channel)
        logger.debug(JSON.stringify(settings))
        
        const new_settings = Object.assign({}, settings, {
            channel: msg.mentions.channels.first().id
        })
        logger.debug(JSON.stringify(new_settings))
        save$(msg.guild.id)(new_settings)
    })
    
handler$('!lotto set role ')
    .subscribe(data => {
        const msg = data[0]
        const role = data[1]
        const settings = data[2]
        
        if(msg.mentions.roles.first() === undefined) {
            msg.reply('Unable to find role mention.')
            return
        }
        
        logger.debug(msg)
        logger.debug(role)
        logger.debug(JSON.stringify(settings))
        
        const new_settings = Object.assign({}, settings, {
            role: msg.mentions.roles.first().id
        })
        logger.debug(JSON.stringify(new_settings))
        save$(msg.guild.id)(new_settings)
    })
    
handler$('!lotto get hours')
    .subscribe(data => {
        const msg = data[0]
        const hours = data[1]
        const settings = data[2]
        
        logger.debug(msg)
        logger.debug(hours)
        logger.debug(JSON.stringify(settings))
        
        msg.reply('hours: ' + settings['hours'])
    })
    
handler$('!lotto get channel')
    .subscribe(data => {
        const msg = data[0]
        const channel = data[1]
        const settings = data[2]
        
        logger.debug(msg)
        logger.debug(channel)
        logger.debug(JSON.stringify(settings))
        
        msg.reply('channel: <#' + settings['channel'] + '>')
    })
    
handler$('!lotto get role')
    .subscribe(data => {
        const msg = data[0]
        const role = data[1]
        const settings = data[2]
        
        logger.debug(msg)
        logger.debug(role)
        logger.debug(JSON.stringify(settings))
        
        msg.reply('role: <@&' + settings['role'] + '>')
    })

const first_ready = first_ready$
    .subscribe((guilds) => {
        logger.info('Connected')
        logger.info('Logged in as:')
        logger.info(client.user.username)
        logger.info(client.user.id)
        
        logger.info('Servers:')
        guilds.forEach(guild => {
            logger.info('* ' + guild.name + ' (' + guild.id + ')')
        })
    })

// probably useless function
const load_settings = first_ready$
    .pipe(
        switchMap(guilds => guilds.map(guild => load$(guild.id)))
    )
    .subscribe(jsons => {
        jsons.forEach(json => {
            logger.debug(JSON.stringify(json))
            
        })
    })

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
