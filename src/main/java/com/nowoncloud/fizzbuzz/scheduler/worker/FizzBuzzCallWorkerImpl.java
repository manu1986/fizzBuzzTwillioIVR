package com.nowoncloud.fizzbuzz.scheduler.worker;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.nowoncloud.fizzbuzz.model.FizzBuzzCall;
import com.nowoncloud.fizzbuzz.service.CallService;
import com.twilio.sdk.TwilioRestException;


@Component("callWorker")
public class FizzBuzzCallWorkerImpl implements Worker {
	@Autowired
	CallService callService;
	
	@Override
	public void work(List<FizzBuzzCall> calls)  {
		
        for (FizzBuzzCall call : calls) {
			try {
				callService.makeCall(call);
				// update sid in db 
			} catch (TwilioRestException e) {
				System.out.println(e.getErrorMessage());
			}
		}
	}


}
