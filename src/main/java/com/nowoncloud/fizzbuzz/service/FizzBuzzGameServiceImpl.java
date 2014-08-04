package com.nowoncloud.fizzbuzz.service;

import org.apache.commons.lang.math.NumberUtils;
import org.springframework.stereotype.Service;

@Service
public class FizzBuzzGameServiceImpl implements FizzBuzzGameService {
	@Override
	public String getFizzBuzzSeq(String startingPoint) {
		StringBuilder retVal = new StringBuilder();
		int startingNumber = NumberUtils.toInt(startingPoint, -1);
		if (startingNumber < 0 || startingNumber > 999) {
			return retVal.toString();
		}
	 for (int i = 1; i <= NumberUtils.toInt(startingPoint, -1); i++) {
            if (i % 15 == 0) {
            	retVal.append("FizzBuzz");
            } else if (i % 3 == 0) {
            	retVal.append("Fizz");
            } else if (i % 5 == 0) {
            	retVal.append("Buzz");
            } else {
            	retVal.append(i);
            }
            retVal.append(" ");
        }
	 return retVal.toString();
	}
}
