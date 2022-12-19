import { EventBusService, TransactionBaseService } from '@medusajs/medusa';
import { formatException } from '@medusajs/medusa/dist/utils/exception-formatter';
import { buildQuery } from '@medusajs/medusa/dist/utils/build-query';
import { MedusaError } from "medusa-core-utils"
import { EntityManager } from "typeorm"
import { LocationRepository } from "../repositories/location";
import { Location } from '../models/location';
import { CreateLocationInput, UpdateLocationInput } from '../types/location';
import { setMetadata } from '@medusajs/medusa/dist/utils';
import { FindConfig, Selector } from '@medusajs/medusa/dist/types/common';
import CalendarTimeperiodService from './calendar-timeperiod';
import CalendarService from './calendar';
import { addDay, divideTimes, formatDate, subDay, zeroTimes } from '../utils/date-utils';

type InjectedDependencies = {
    manager: EntityManager
    locationRepository: typeof LocationRepository
    eventBusService: EventBusService
    calendarService: CalendarService
    calendarTimeperiodService: CalendarTimeperiodService
}

class LocationService extends TransactionBaseService {
    protected manager_: EntityManager
    protected transactionManager_: EntityManager | undefined

    protected readonly locationRepository_: typeof LocationRepository
    protected readonly eventBus_: EventBusService
    protected readonly calendar_: CalendarService
    protected readonly calendarTimeperiod_: CalendarTimeperiodService

    static readonly IndexName = `locations`
    static readonly Events = {
        UPDATED: "location.updated",
        CREATED: "location.created",
        DELETED: "location.deleted",
    }

    constructor({ manager, locationRepository, eventBusService, calendarService, calendarTimeperiodService }: InjectedDependencies) {
        super(arguments[0]);

        this.manager_ = manager;
        this.locationRepository_ = locationRepository;
        this.eventBus_ = eventBusService;
        this.calendar_ = calendarService
        this.calendarTimeperiod_ = calendarTimeperiodService
    }

    async list(
        selector: Selector<Location>,
        config: FindConfig<Location> = {
          skip: 0,
          take: 50,
          relations: [],
        }
      ): Promise<Location[]> {
        const locationRepo = this.manager_.getCustomRepository(this.locationRepository_)
    
        const query = buildQuery(selector, config)
    
        return locationRepo.find(query)
    }

    async retrieve(locationId: string, config: FindConfig<Location>) {
        const manager = this.manager_
        const locationRepo = manager.getCustomRepository(this.locationRepository_)

        const location = await locationRepo.findOne(locationId, config)

        if (!location) {
            throw new MedusaError(
                MedusaError.Types.NOT_FOUND,
                `Location with ${locationId} was not found`
            )
        }

        return location
    }

    async create(locationObject: CreateLocationInput): Promise<Location> {
        return await this.atomicPhase_(async (manager) => {
            const locationRepo = manager.getCustomRepository(this.locationRepository_)

            const {
                ...rest
            } = locationObject

            try {
                let location: any = locationRepo.create(rest)
                location = await locationRepo.save(location)

                const result = await this.retrieve(location.id, {
                    relations: ["country", "company"],
                })

                await this.eventBus_
                    .withTransaction(manager)
                    .emit(LocationService.Events.CREATED, {
                        id: result.id,
                    })
                return result
            } catch (error) {
                throw formatException(error)
            }
        })
    }

    async delete(locationId: string): Promise<void> {
        return await this.atomicPhase_(async (manager) => {
            const locationRepo = manager.getCustomRepository(this.locationRepository_)

            const location = await locationRepo.findOne(
                { id: locationId },
                { relations: ["country", "company"] }
            )

            if (!location) {
                return
            }

            await locationRepo.softRemove(location)

            await this.eventBus_
                .withTransaction(manager)
                .emit(LocationService.Events.DELETED, {
                    id: locationId,
                })

            return Promise.resolve()
        })
    }

    async update(
        locationId: string,
        update: UpdateLocationInput
    ): Promise<Location> {
        return await this.atomicPhase_(async (manager) => {
            const locationRepo = manager.getCustomRepository(this.locationRepository_)

            const location = await this.retrieve(locationId, {})

            const {
                metadata,
                ...rest
            } = update


            if (metadata) {
                location.metadata = setMetadata(location, metadata)
            }

            for (const [key, value] of Object.entries(rest)) {
                if (typeof value !== `undefined`) {
                    location[key] = value
                }
            }

            const result = await locationRepo.save(location)

            await this.eventBus_
                .withTransaction(manager)
                .emit(LocationService.Events.UPDATED, {
                    id: result.id,
                    fields: Object.keys(update),
                })
            return result
        })
    }

    async getSlotTime(locationId: string, from?: Date, to?: Date, slot_time?: number, use_custom_time?: boolean) {
        const dateFrom = new Date(from ? from : zeroTimes(new Date())) // zeroTimes set all time to 00:00:00
        const dateTo = new Date(to ? addDay(to, 1) : zeroTimes(new Date().setUTCDate(dateFrom.getDate() + 28))) // 28 = 4 weeks
        const availableTimes = []

        // other [note]
        // work_times [working_hour]
        // blocked_times [breaktime / blocked / off]
        
        const location = await this.retrieve(locationId, {
            relations: [
                "company",
                "calendars"
            ]
        })

        // get all connection calendar from location
        for (const cx of location.calendars) {
            // select working_time and blocked_time
            const blockedTimerperiod = await this.calendarTimeperiod_.list({ calendar_id: cx.id, from: { gte: dateFrom, lte: dateTo }, to: { gte: dateFrom, lte: dateTo }, type: ["breaktime", "blocked", "off"] }, { order: { from: "DESC" }})
            const workingTimerperiod = await this.calendarTimeperiod_.list({ calendar_id: cx.id, from: { gte: dateFrom, lte: dateTo }, to: { gte: dateFrom, lte: dateTo }, type: "working_hour" }, { order: { from: "DESC" }})
            const workingTimes = []
            const blockedTimes = []
            const divideBy = 15
            
            // divide into hours by 5 minutes and day as key object

            // working time
            for (const x of workingTimerperiod) {
                const getKey = formatDate(x.from)
                workingTimes[getKey] = divideTimes(x.from, x.to, divideBy)
            }

            // blocked time
            for (const x of blockedTimerperiod) {
                const getKey = formatDate(x.from)
                if (!blockedTimes[getKey]) blockedTimes[getKey] = []
                const resultDivide = divideTimes(x.from, x.to, divideBy)
                resultDivide.map((xx) => blockedTimes[getKey].push(xx))
            }

            // filter working time with blocked time
            for (const x in workingTimes) {
                let pushNow = {
                    date: x,
                    slot_times: []
                }
                
                pushNow.slot_times = !blockedTimes[x] ? workingTimes[x] : pushNow.slot_times = workingTimes[x].filter(item => !blockedTimes[x].includes(item))
                
                availableTimes.push(pushNow)
            }
        }
        
        return availableTimes
    }
}

export default LocationService;