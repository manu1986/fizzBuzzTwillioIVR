package com.nowoncloud.fizzbuzz.scheduler.worker;

import java.util.List;

import org.apache.log4j.Logger;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.nowoncloud.fizzbuzz.domain.FizzBuzzCallEntity;
import com.nowoncloud.fizzbuzz.service.CallService;
import com.twilio.sdk.TwilioRestException;


@Component("callWorker")
public class FizzBuzzCallWorkerImpl implements Worker {
	private static final Logger logger = Logger.getLogger(FizzBuzzCallWorkerImpl.class);
	@Autowired
	CallService callService;
	
	@Override
	public void work(List<FizzBuzzCallEntity> calls)  {
		
        for (FizzBuzzCallEntity call : calls) {
			try {
				callService.makeCall(call);
			} catch (TwilioRestException e) {
				logger.error(e);
			}
		}
	}


}
