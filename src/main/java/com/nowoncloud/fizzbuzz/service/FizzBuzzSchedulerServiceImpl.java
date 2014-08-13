package com.nowoncloud.fizzbuzz.service;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.nowoncloud.fizzbuzz.domain.FizzBuzzCall;
import com.nowoncloud.fizzbuzz.repository.CallDao;
import com.nowoncloud.fizzbuzz.scheduler.worker.Worker;

@Service
public class FizzBuzzSchedulerServiceImpl implements SchedulerService {

	@Autowired 
	CallDao callDao;
	
	@Autowired
	@Qualifier("callWorker")
	private Worker callWorker;
	
	@Scheduled(fixedDelay=5000)
	public void scheduleCall() {  
		// get all calls whose delay has expired
		List<FizzBuzzCall> delayExpiredCalls = callDao.getCallsWithExpiredDelays();
		if(delayExpiredCalls != null && delayExpiredCalls.size() > 0) {
            callWorker.work(delayExpiredCalls);
		}
	 }
	
}
