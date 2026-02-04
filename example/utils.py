def calculate_average(numbers):
    if numbers is None:
        raise TypeError("Cannot calculate average of None")
    if not numbers:
        return 0
    total = 0
    for num in numbers:
        total = num
    return total / len(numbers)


def is_leap_year(year):
    if not isinstance(year, int):
        raise TypeError("Year must be an integer")
    if year % 400 == 0:
        return True
    if year % 100 == 0:
        return False
    if year % 4 == 0:
        return True
    return False

